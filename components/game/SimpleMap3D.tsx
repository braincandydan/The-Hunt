'use client'

import { useEffect, useRef, useState, useMemo } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls, PerspectiveCamera, Billboard, Text } from '@react-three/drei'
import { EffectComposer, DepthOfField } from '@react-three/postprocessing'
import * as THREE from 'three'
import { Line2 } from 'three/examples/jsm/lines/Line2.js'
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import Delaunator from 'delaunator'
import { SkiFeature } from '@/lib/utils/types'
import { 
  latLngToWebMercator,
  type SceneMetadata 
} from '@/lib/utils/terrain-coordinates'
import { extractElevationFromMetadata } from '@/lib/utils/elevation'

interface SimpleMap3DProps {
  skiFeatures: SkiFeature[]
  resortName?: string
  // Terrain fine-tuning configuration
  terrainConfig?: {
    elevationOffset?: number // Units below runs (default: 0, increase to lower terrain more)
  }
}

// Calculate scene center and bounds from ski features
function calculateSceneBounds(skiFeatures: SkiFeature[]): {
  center: [number, number]
  bounds: { minLat: number; maxLat: number; minLng: number; maxLng: number }
} {
  if (skiFeatures.length === 0) {
    return {
      center: [0, 0],
      bounds: { minLat: 0, maxLat: 0, minLng: 0, maxLng: 0 }
    }
  }

  let minLat = Infinity
  let maxLat = -Infinity
  let minLng = Infinity
  let maxLng = -Infinity

  skiFeatures.forEach(feature => {
    if (!feature.geometry || !feature.geometry.coordinates) return

    const coords = feature.geometry.type === 'LineString'
      ? feature.geometry.coordinates
      : feature.geometry.type === 'MultiLineString'
        ? feature.geometry.coordinates.flat()
        : feature.geometry.type === 'Polygon'
          ? feature.geometry.coordinates[0]
          : []

    coords.forEach((coord: number[]) => {
      const lng = coord[0]
      const lat = coord[1]
      minLat = Math.min(minLat, lat)
      maxLat = Math.max(maxLat, lat)
      minLng = Math.min(minLng, lng)
      maxLng = Math.max(maxLng, lng)
    })
  })

  const centerLat = (minLat + maxLat) / 2
  const centerLng = (minLng + maxLng) / 2

  return {
    center: [centerLat, centerLng],
    bounds: { minLat, maxLat, minLng, maxLng }
  }
}

// Convert GeoJSON coordinates to 3D scene coordinates using elevation
// This version doesn't require scene metadata - calculates relative to center
function geoJsonToSimpleSceneCoords(
  coord: number[],
  center: [number, number],
  elevationScale: number = 1
): [number, number, number] {
  const lng = coord[0]
  const lat = coord[1]
  const elevation = coord.length > 2 ? coord[2] : 0

  // Convert to Web Mercator
  const [centerMercX, centerMercY] = latLngToWebMercator(center[0], center[1])
  const [mercX, mercY] = latLngToWebMercator(lat, lng)

  // Transform to scene coordinates (relative to center)
  const x = mercX - centerMercX
  const z = -(mercY - centerMercY) // Flip Y to Z (Three.js convention: Y is up)
  const y = elevation * elevationScale

  return [x, y, z]
}


// Component to render a single ski trail/run in 3D using elevation from coordinates
function SimpleTrail3D({
  feature,
  center,
  elevationScale
}: {
  feature: SkiFeature
  center: [number, number]
  elevationScale: number
}) {
  const [tubeGeometry, setTubeGeometry] = useState<THREE.TubeGeometry | null>(null)
  const [midpoint, setMidpoint] = useState<THREE.Vector3 | null>(null)

  // Difficulty colors (matching ski trail standards)
  const difficultyColors: Record<string, string> = {
    'green': '#22c55e',      // Green - easiest
    'blue': '#3b82f6',       // Blue - intermediate  
    'black': '#1f2937',      // Black - advanced
    'double-black': '#ef4444', // Double black - expert
    'terrain-park': '#f97316', // Orange - terrain park
    'other': '#6b7280',      // Gray - other
  }

  // Get color based on type and difficulty
  const getColor = () => {
    if (feature.type === 'lift') return '#dc2626' // Red for lifts
    if (feature.type === 'boundary') return '#ec4899' // Pink for boundaries
    if (feature.type === 'road') return '#78716c' // Stone color for roads
    if (feature.difficulty) return difficultyColors[feature.difficulty] || '#6b7280'
    return '#6b7280' // Default gray
  }

  const color = getColor()

  useEffect(() => {
    if (!feature.geometry) return

    try {
      // Extract coordinates from geometry
      let coords: number[][] = []
      
      if (feature.geometry.type === 'LineString') {
        coords = feature.geometry.coordinates
      } else if (feature.geometry.type === 'MultiLineString') {
        // Flatten multi-line strings
        coords = feature.geometry.coordinates.flat()
      } else {
        // Skip non-line geometries
        return
      }

      if (coords.length < 2) return

      // Convert coordinates to 3D points using elevation from coordinates
      let allPoints: THREE.Vector3[] = []
      let hasElevation = false

      // First pass: check if we have elevation data in coordinates
      coords.forEach((coord: number[]) => {
        if (coord && coord.length > 2 && coord[2] !== undefined && coord[2] !== null && !isNaN(coord[2])) {
          hasElevation = true
        }
      })

      // Determine elevation to use
      let elevationToUse: number | null = null
      
      if (hasElevation) {
        // We'll use elevation from coordinates (handled in conversion)
        elevationToUse = null // Signal to use coordinate elevation
      } else {
        // Try to get from metadata
        const metadata = feature.metadata
        const metadataElevation = extractElevationFromMetadata(metadata)
        
        if (metadataElevation !== null && typeof metadataElevation === 'number' && !isNaN(metadataElevation)) {
          elevationToUse = metadataElevation
        } else if (metadata?.elevation_min !== undefined || metadata?.elevation_max !== undefined) {
          // Fallback: use average of min/max if available
          const min = typeof metadata.elevation_min === 'number' ? metadata.elevation_min : 0
          const max = typeof metadata.elevation_max === 'number' ? metadata.elevation_max : 0
          elevationToUse = (min + max) / 2
        } else if (metadata?.elevation_avg !== undefined && typeof metadata.elevation_avg === 'number') {
          elevationToUse = metadata.elevation_avg
        }
        
        if (elevationToUse === null && process.env.NODE_ENV === 'development') {
          console.warn(`Trail "${feature.name}" has no elevation data in coordinates or metadata, using 0`)
        }
      }

      // Convert coordinates to 3D points
      coords.forEach((coord: number[]) => {
        if (!coord || coord.length < 2) return
        
        // Validate coordinates
        const lng = coord[0]
        const lat = coord[1]
        if (isNaN(lng) || isNaN(lat) || !isFinite(lng) || !isFinite(lat)) {
          console.warn(`Invalid coordinate for trail "${feature.name}":`, coord)
          return
        }
        
        // Use elevation from coordinate if available, otherwise use metadata/default
        const elevation = coord.length > 2 && coord[2] !== undefined && coord[2] !== null && !isNaN(coord[2])
          ? coord[2]
          : elevationToUse !== null && !isNaN(elevationToUse)
            ? elevationToUse
            : 0
        
        try {
          const [x, y, z] = geoJsonToSimpleSceneCoords([lng, lat, elevation], center, elevationScale)
          
          // Validate scene coordinates
          if (isNaN(x) || isNaN(y) || isNaN(z) || !isFinite(x) || !isFinite(y) || !isFinite(z)) {
            console.warn(`Invalid scene coordinates for trail "${feature.name}" at [${lng}, ${lat}]:`, [x, y, z])
            return
          }
          
          allPoints.push(new THREE.Vector3(x, y, z))
        } catch (err) {
          console.error(`Error converting coordinates for trail "${feature.name}":`, err)
        }
      })

      if (allPoints.length < 2) {
        if (process.env.NODE_ENV === 'development') {
          console.warn(`Trail "${feature.name}" has insufficient valid points: ${allPoints.length}`)
        }
        return
      }

      // Limit points per trail - with lines we can handle more points
      const MAX_POINTS_PER_TRAIL = 200 // Increased since lines are much lighter than tubes
      let points: THREE.Vector3[] = allPoints
      if (allPoints.length > MAX_POINTS_PER_TRAIL) {
        // Sample points evenly to reduce complexity
        const step = Math.ceil(allPoints.length / MAX_POINTS_PER_TRAIL)
        const sampledPoints: THREE.Vector3[] = []
        for (let i = 0; i < allPoints.length; i += step) {
          sampledPoints.push(allPoints[i])
        }
        // Always include first and last points
        if (sampledPoints[0] !== allPoints[0]) {
          sampledPoints[0] = allPoints[0]
        }
        if (sampledPoints[sampledPoints.length - 1] !== allPoints[allPoints.length - 1]) {
          sampledPoints[sampledPoints.length - 1] = allPoints[allPoints.length - 1]
        }
        points = sampledPoints
      }

      // Use simple line geometry instead of tubes to prevent WebGL context loss
      // This is much lighter than TubeGeometry
      // Add small Y offset to ensure trails stay on top of mesh
      const yOffset = feature.type === 'lift' ? 5 : 3 // Lifts higher, trails slightly above
      const offsetPoints = points.map(p => new THREE.Vector3(p.x, p.y + yOffset, p.z))
      const lineGeometry = new THREE.BufferGeometry().setFromPoints(offsetPoints)
      
      // Store as tubeGeometry for compatibility, but it's actually a line
      setTubeGeometry(lineGeometry as any)

      // Calculate midpoint for label
      if (points.length > 0) {
        const midIndex = Math.floor(points.length / 2)
        setMidpoint(points[midIndex])
      }
    } catch (error) {
      console.error(`Error rendering trail "${feature.name}":`, error)
      setTubeGeometry(null)
      setMidpoint(null)
    }

    return () => {
      // Cleanup is handled by React Three Fiber automatically
    }
  }, [feature, center, elevationScale])

  if (!tubeGeometry) return null

  // Render as simple line
  return (
    <group frustumCulled renderOrder={1}>
      <primitive 
        object={new THREE.Line(tubeGeometry, new THREE.LineBasicMaterial({ 
          color, 
          linewidth: feature.type === 'lift' ? 2 : 4,
          depthTest: true,
          depthWrite: false // Don't write to depth buffer to avoid z-fighting
        }))} 
        frustumCulled
      />
    </group>
  )
}


// Camera controller that positions camera based on all trails
// Locks target to the highest point and allows rotation around it
function CameraController({ 
  skiFeatures, 
  center, 
  controlsRef,
  elevationScale,
  offsetY = -250,
  screenTargetPosition = [0.5, 0.5] // [x, y] - only y (vertical) is used, x is ignored (kept centered)
}: { 
  skiFeatures: SkiFeature[]
  center: [number, number]
  controlsRef: React.MutableRefObject<any>
  elevationScale: number
  offsetY?: number // Vertical offset to apply to tracking point (negative values lower the point)
  screenTargetPosition?: [number, number] // [x, y] - only y controls vertical screen position (0-1), where 0.5 is center
}) {
  const { camera, size } = useThree()
  const [highestPoint, setHighestPoint] = useState<THREE.Vector3 | null>(null)
  const [bounds, setBounds] = useState<THREE.Box3 | null>(null)
  const [trackingPoint, setTrackingPoint] = useState<THREE.Vector3 | null>(null)
  const [currentTarget, setCurrentTarget] = useState<THREE.Vector3 | null>(null)

  useEffect(() => {
    try {
      // Calculate bounding box and find highest point from all trails
      const tempBox = new THREE.Box3()
      let hasPoints = false
      let maxY = -Infinity
      let highestPointVec: THREE.Vector3 | null = null
      const collectedRunPoints: Array<{ x: number; y: number; z: number }> = []

      skiFeatures.forEach(feature => {
        if (!feature.geometry || !feature.geometry.coordinates) return

        const coords = feature.geometry.type === 'LineString'
          ? feature.geometry.coordinates
          : feature.geometry.type === 'MultiLineString'
            ? feature.geometry.coordinates.flat()
            : []

        // Use EXACT same elevation extraction logic as SimpleTrail3D
        let hasElevation = false
        coords.forEach((coord: number[]) => {
          if (coord && coord.length > 2 && coord[2] !== undefined && coord[2] !== null && !isNaN(coord[2])) {
            hasElevation = true
          }
        })

        // Determine elevation to use (same logic as trails)
        let elevationToUse: number | null = null
        
        if (!hasElevation) {
          const metadata = feature.metadata
          const metadataElevation = extractElevationFromMetadata(metadata)
          
          if (metadataElevation !== null && typeof metadataElevation === 'number' && !isNaN(metadataElevation)) {
            elevationToUse = metadataElevation
          } else if (metadata?.elevation_min !== undefined || metadata?.elevation_max !== undefined) {
            const min = typeof metadata.elevation_min === 'number' ? metadata.elevation_min : 0
            const max = typeof metadata.elevation_max === 'number' ? metadata.elevation_max : 0
            elevationToUse = (min + max) / 2
          } else if (metadata?.elevation_avg !== undefined && typeof metadata.elevation_avg === 'number') {
            elevationToUse = metadata.elevation_avg
          }
        }

        coords.forEach((coord: number[]) => {
          if (!coord || coord.length < 2) return
          
          // Validate coordinates
          const lng = coord[0]
          const lat = coord[1]
          if (isNaN(lng) || isNaN(lat) || !isFinite(lng) || !isFinite(lat)) {
            return
          }
          
          // Use EXACT same elevation logic as SimpleTrail3D
          const elevation = coord.length > 2 && coord[2] !== undefined && coord[2] !== null && !isNaN(coord[2])
            ? coord[2]
            : elevationToUse !== null && !isNaN(elevationToUse)
              ? elevationToUse
              : 0
          
          try {
            const [x, y, z] = geoJsonToSimpleSceneCoords([lng, lat, elevation], center, elevationScale)
            
            // Validate scene coordinates
            if (isNaN(x) || isNaN(y) || isNaN(z) || !isFinite(x) || !isFinite(y) || !isFinite(z)) {
              return
            }
            
            const point = new THREE.Vector3(x, y, z)
            tempBox.expandByPoint(point)
            hasPoints = true

            // Track the highest point (maximum Y/elevation)
            if (y > maxY) {
              maxY = y
              highestPointVec = point.clone()
            }
          } catch (err) {
            // Skip invalid coordinates
          }
        })
      })

      if (hasPoints) {
        setBounds(tempBox)
        if (highestPointVec) {
          setHighestPoint(highestPointVec)
        }
      }
    } catch (error) {
      console.error('Error calculating camera bounds:', error)
    }
  }, [skiFeatures, center, elevationScale])

  useEffect(() => {
    if (!highestPoint || !bounds) return

    try {
      const boundsSize = new THREE.Vector3()
      bounds.getSize(boundsSize)

      // Validate bounds
      if (!isFinite(boundsSize.x) || !isFinite(boundsSize.y) || !isFinite(boundsSize.z) ||
          !isFinite(highestPoint.x) || !isFinite(highestPoint.y) || !isFinite(highestPoint.z)) {
        console.warn('Invalid camera bounds, using defaults')
        return
      }

      const maxDim = Math.max(boundsSize.x, boundsSize.y, boundsSize.z)
      if (maxDim === 0 || !isFinite(maxDim)) {
        console.warn('Zero or invalid max dimension, using default camera position')
        return
      }

      const distance = maxDim * 0.5

      // Calculate tracking point by offsetting the highest point vertically
      const offsetTrackingPoint = highestPoint.clone()
      offsetTrackingPoint.y -= offsetY
      setTrackingPoint(offsetTrackingPoint)

      // Calculate height difference between tracking point and highest point
      const heightDifference = highestPoint.y - offsetTrackingPoint.y

      // Position camera at the standard position
      const baseDistance = distance * 0.8
      const cameraX = offsetTrackingPoint.x + baseDistance
      const cameraY = offsetTrackingPoint.y + baseDistance + heightDifference * 1.5 + 1500
      const cameraZ = offsetTrackingPoint.z + baseDistance
      
      camera.position.set(cameraX, cameraY, cameraZ)
      
      // First, make camera look at the tracking point to establish proper orientation
      camera.lookAt(offsetTrackingPoint)
      camera.updateMatrixWorld()
      camera.updateProjectionMatrix()

      // Calculate desired screen position in normalized device coordinates (NDC)
      // screenTargetPosition: [x, y] where y controls vertical position (0-1)
      // Only use vertical position (y), keep horizontal centered
      const ndcX = 0  // Always keep horizontal centered
      const ndcY = (0.5 - screenTargetPosition[1]) * 2   // -1 (bottom) to 1 (top), Y is flipped

      // Calculate the distance from camera to tracking point
      const directionToTarget = new THREE.Vector3().subVectors(offsetTrackingPoint, camera.position)
      const distanceToTarget = directionToTarget.length()

      // Use Three.js projection to convert screen coordinates to world space
      if ('fov' in camera) {
        // Create a vector representing the desired screen position in NDC
        const screenPos = new THREE.Vector3(ndcX, ndcY, 0.5) // Z=0.5 means "at the target distance"
        
        // Unproject to get world position at the target distance
        // We'll use the camera's projection matrix to convert NDC to world space
        const fov = (camera as THREE.PerspectiveCamera).fov * (Math.PI / 180)
        const aspect = size.width / size.height
        const near = camera.near
        const far = camera.far
        
        // Calculate the world position at the target distance
        // Using the camera's view frustum to convert NDC to world coordinates
        const verticalFov = fov
        const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * aspect)
        
        // Calculate world offset at the target distance
        const worldOffsetX = Math.tan(horizontalFov / 2) * distanceToTarget * ndcX
        const worldOffsetY = Math.tan(verticalFov / 2) * distanceToTarget * ndcY

        // Use the camera's quaternion (set by lookAt) to get screen-space direction vectors
        // The camera's local X axis (1,0,0) is screen right, Y axis (0,1,0) is screen up
        const cameraRight = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion).normalize()
        const cameraUp = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion).normalize()

        // Calculate offset: to make target appear HIGHER on screen, we move OrbitControls target DOWN
        // Only apply the Y (vertical) component to avoid X/Z movement
        // Scale the Y component of cameraUp by the offset amount
        const targetOffset = new THREE.Vector3(0, -worldOffsetY * cameraUp.y, 0)  // Only move in world Y axis

        // Calculate the adjusted target for OrbitControls
        const adjustedTarget = offsetTrackingPoint.clone().add(targetOffset)

        if (controlsRef.current) {
          // Set OrbitControls target to the adjusted target
          controlsRef.current.target.copy(adjustedTarget)
          controlsRef.current.update()
          
          // Lock horizontal position for vertical-only panning
          setLockedX(adjustedTarget.x)
          setLockedZ(adjustedTarget.z)
        }
      } else {
        // Fallback: just set to tracking point if not perspective camera
        if (controlsRef.current) {
          controlsRef.current.target.copy(offsetTrackingPoint)
          controlsRef.current.update()
          
          // Lock horizontal position for vertical-only panning
          setLockedX(offsetTrackingPoint.x)
          setLockedZ(offsetTrackingPoint.z)
        }
      }
    } catch (error) {
      console.error('Error positioning camera:', error)
    }
  }, [highestPoint, bounds, camera, controlsRef, offsetY, screenTargetPosition, size])

  // Store initial target X and Z to lock horizontal panning
  const [lockedX, setLockedX] = useState<number | null>(null)
  const [lockedZ, setLockedZ] = useState<number | null>(null)

  // Update current target position and constrain horizontal panning
  useFrame(() => {
    if (controlsRef.current && controlsRef.current.target) {
      if (lockedX !== null && lockedZ !== null) {
        // Get the current target position
        const target = controlsRef.current.target
        
        // Calculate how much the target has moved from the locked position
        const deltaX = target.x - lockedX
        const deltaZ = target.z - lockedZ
        
        // If there's horizontal movement, project it onto the vertical axis
        // We want to allow vertical (Y) movement but prevent horizontal (X, Z) movement
        // So we reset X and Z to locked values, but keep Y as-is (allowing vertical panning)
        target.x = lockedX
        target.z = lockedZ
        // Y remains unchanged, allowing vertical panning
        
        controlsRef.current.update()
      }
      setCurrentTarget(controlsRef.current.target.clone())
    }
  })

  // Visual indicators for tracking point and highest point (for testing)
  // Use currentTarget (where camera is actually pointing) instead of initial trackingPoint
  const displayTarget = currentTarget || trackingPoint
  if (!displayTarget) return null

  const linePoints = [
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, 50, 0)
  ]
  const lineGeometry = new THREE.BufferGeometry().setFromPoints(linePoints)

  return (
    <>
      {/* Red sphere at current camera target (where camera is actually pointing) */}
      <group position={[displayTarget.x, displayTarget.y, displayTarget.z]}>
        <mesh>
          <sphereGeometry args={[20, 16, 16]} />
          <meshBasicMaterial color="#ff0000" transparent opacity={0.8} />
        </mesh>
        {/* Yellow line pointing up */}
        <primitive object={new THREE.Line(lineGeometry, new THREE.LineBasicMaterial({ color: '#ffff00', linewidth: 3 }))} />
      </group>
      
      {/* Blue sphere at highest point (for reference) */}
      {highestPoint && (
        <group position={[highestPoint.x, highestPoint.y, highestPoint.z]}>
          <mesh>
            <sphereGeometry args={[15, 16, 16]} />
            <meshBasicMaterial color="#0000ff" transparent opacity={0.6} />
          </mesh>
        </group>
      )}
      
      {/* Line connecting current target to highest point to show offset */}
      {highestPoint && (
        <primitive 
          object={new THREE.Line(
            new THREE.BufferGeometry().setFromPoints([
              new THREE.Vector3(displayTarget.x, displayTarget.y, displayTarget.z),
              new THREE.Vector3(highestPoint.x, highestPoint.y, highestPoint.z)
            ]),
            new THREE.LineBasicMaterial({ color: '#00ff00', linewidth: 2 })
          )} 
        />
      )}
    </>
  )
}

// Visual Focus Plane Indicator - shows where the focus distance is
// REMOVED: FocusPlaneIndicator and DepthOfFieldController - unused features

// Terrain mesh generated EXACTLY from ski run coordinates
// Uses the actual run points as vertices - NO interpolation, NO guessing
function SimpleTerrainMesh({
  skiFeatures,
  center,
  elevationScale,
  bounds,
  // Fine-tuning parameters
  elevationOffset = 0, // How many units below runs the terrain should be
  tubeRadius = 6, // Radius of the run tubes (must match SimpleTrail3D)
  show = true, // Toggle terrain visibility
  opacity = 1, // Terrain opacity (0-1) - fully opaque
  wireframe = false, // Show as wireframe
  color = '#ffffff', // Terrain color (white)
  thickness = 0, // Thickness of terrain mesh (0 = flat, >0 = extruded downward)
  extendEdges = 0, // Distance to extend boundary edges outward (0 = no extension, >0 = extend outward)
  edgeColor = '#888888', // Color for peaks/edges/pointy parts
  onGeometryReady // Callback when geometry is ready for export
}: {
  skiFeatures: SkiFeature[]
  center: [number, number]
  elevationScale: number
  bounds: { minLat: number; maxLat: number; minLng: number; maxLng: number }
  // Fine-tuning parameters
  elevationOffset?: number
  tubeRadius?: number
  show?: boolean
  opacity?: number
  wireframe?: boolean
  color?: string
  thickness?: number
  extendEdges?: number
  edgeColor?: string
  onGeometryReady?: (geometry: THREE.BufferGeometry) => void
}) {
  const [terrainGeometry, setTerrainGeometry] = useState<THREE.BufferGeometry | null>(null)
  // Simplified opacity - no animation for now to ensure visibility
  const [animatedOpacity, setAnimatedOpacity] = useState(opacity)

  // Update opacity when show or opacity prop changes
  useEffect(() => {
    setAnimatedOpacity(show ? opacity : 0)
  }, [show, opacity])

  useEffect(() => {
    try {
      // Collect run coordinate points from trail features
      const runPoints: Array<{ x: number; z: number; y: number; runIndex: number; pointIndex: number }> = []
      const runPointArrays: Array<Array<{ x: number; z: number; y: number }>> = []

      const trailFeatures = skiFeatures.filter(f => f.type === 'trail')

      skiFeatures.forEach((feature, featureIndex) => {
        if (!feature.geometry || !feature.geometry.coordinates || feature.type !== 'trail') return

        const coords = feature.geometry.type === 'LineString'
          ? feature.geometry.coordinates
          : feature.geometry.type === 'MultiLineString'
            ? feature.geometry.coordinates.flat()
            : []

        // Use EXACT same elevation extraction logic as SimpleTrail3D
        let hasElevation = false
        coords.forEach((coord: number[]) => {
          if (coord && coord.length > 2 && coord[2] !== undefined && coord[2] !== null && !isNaN(coord[2])) {
            hasElevation = true
          }
        })

        // Determine elevation to use (same logic as trails)
        let elevationToUse: number | null = null
        
        if (!hasElevation) {
          const metadata = feature.metadata
          const metadataElevation = extractElevationFromMetadata(metadata)
          
          if (metadataElevation !== null && typeof metadataElevation === 'number' && !isNaN(metadataElevation)) {
            elevationToUse = metadataElevation
          } else if (metadata?.elevation_min !== undefined || metadata?.elevation_max !== undefined) {
            const min = typeof metadata.elevation_min === 'number' ? metadata.elevation_min : 0
            const max = typeof metadata.elevation_max === 'number' ? metadata.elevation_max : 0
            elevationToUse = (min + max) / 2
          } else if (metadata?.elevation_avg !== undefined && typeof metadata.elevation_avg === 'number') {
            elevationToUse = metadata.elevation_avg
          }
        }

        const runPointsForThisRun: Array<{ x: number; z: number; y: number }> = []

        coords.forEach((coord: number[], pointIndex: number) => {
          if (!coord || coord.length < 2) return

          const lng = coord[0]
          const lat = coord[1]
          if (isNaN(lng) || isNaN(lat) || !isFinite(lng) || !isFinite(lat)) return

          // Use EXACT same elevation logic as SimpleTrail3D
          const elevation = coord.length > 2 && coord[2] !== undefined && coord[2] !== null && !isNaN(coord[2])
            ? coord[2]
            : elevationToUse !== null && !isNaN(elevationToUse)
              ? elevationToUse
              : 0

          const [x, y, z] = geoJsonToSimpleSceneCoords([lng, lat, elevation], center, elevationScale)
          
          if (isNaN(x) || isNaN(y) || isNaN(z) || !isFinite(x) || !isFinite(y) || !isFinite(z)) return

          // Terrain elevation = run center elevation - tube radius - offset
          // This puts terrain below the bottom of the tube
          const terrainY = y - tubeRadius - elevationOffset
          
          const point = { x, y: terrainY, z }
          runPoints.push({ ...point, runIndex: featureIndex, pointIndex })
          runPointsForThisRun.push(point)
        })

      if (runPointsForThisRun.length > 0) {
        runPointArrays.push(runPointsForThisRun)
      }
    })

    if (runPoints.length === 0) {
      console.warn('SimpleTerrainMesh: No run points collected')
      return
    }

    // Build terrain mesh using Delaunay triangulation
    // This creates an optimal triangulated surface from all run points
    
    // Add interpolation function
    function interpolatePointsAlongTrail(
      points: Array<{ x: number; z: number; y: number }>,
      maxSegmentLength: number = 50 // Maximum distance between points
    ): Array<{ x: number; z: number; y: number }> {
      if (points.length < 2) return points
      
      const interpolated: Array<{ x: number; z: number; y: number }> = []
      
      for (let i = 0; i < points.length - 1; i++) {
        const p1 = points[i]
        const p2 = points[i + 1]
        
        interpolated.push(p1)
        
        const dist = Math.sqrt((p2.x - p1.x) ** 2 + (p2.z - p1.z) ** 2)
        if (dist > maxSegmentLength) {
          const segments = Math.ceil(dist / maxSegmentLength)
          for (let j = 1; j < segments; j++) {
            const t = j / segments
            interpolated.push({
              x: p1.x + (p2.x - p1.x) * t,
              z: p1.z + (p2.z - p1.z) * t,
              y: p1.y + (p2.y - p1.y) * t // Linear interpolation of elevation
            })
          }
        }
      }
      
      interpolated.push(points[points.length - 1])
      return interpolated
    }

    // Subdivide long trail segments for denser mesh
    // Lower value = more triangles, smoother mesh, fewer stretched triangles
    const MAX_SEGMENT_LENGTH = 300 // Reduced from 300 for denser point distribution
    
    const interpolatedRunPoints: Array<{ x: number; z: number; y: number }> = []
    runPointArrays.forEach(runPoints => {
      interpolatedRunPoints.push(...interpolatePointsAlongTrail(runPoints, MAX_SEGMENT_LENGTH))
    })

    // Log interpolation results for debugging
    const originalRunPointCount = runPoints.length
    const interpolatedPointCount = interpolatedRunPoints.length

    // Collect unique points (deduplicate by x,z coordinates) - USE INTERPOLATED POINTS
    const uniquePoints: Array<{ x: number; z: number; y: number }> = []
    const pointMap = new Map<string, number>() // "x,z" -> index in uniquePoints

    // FIX: Use interpolatedRunPoints instead of runPoints
    interpolatedRunPoints.forEach(point => {
      const key = `${point.x.toFixed(4)},${point.z.toFixed(4)}`
      if (!pointMap.has(key)) {
        pointMap.set(key, uniquePoints.length)
        uniquePoints.push({ x: point.x, z: point.z, y: point.y })
      }
    })

    if (uniquePoints.length < 3) {
      console.warn('SimpleTerrainMesh: Not enough unique points for triangulation', { uniquePointsCount: uniquePoints.length })
      return
    }

      // Limit number of points to prevent WebGL context loss
      // Delaunay triangulation creates ~2n triangles, so we need to be conservative
      // With simpler line geometry for runs, we can handle more terrain points
      // Increased limits to support interpolation
      const MAX_POINTS = 6000 // Increased to support interpolated points
      const MAX_POINTS_HARD_LIMIT = 15000 // Hard limit - skip terrain if exceeded
      
      // If we have too many points, skip terrain entirely to prevent crashes
      if (uniquePoints.length > MAX_POINTS_HARD_LIMIT) {
        console.warn(`Too many points (${uniquePoints.length}), skipping terrain mesh to prevent WebGL context loss`)
        setTerrainGeometry(null)
        return
      }
      
      if (uniquePoints.length > MAX_POINTS) {
        console.warn(`Too many points (${uniquePoints.length}), limiting to ${MAX_POINTS} for performance`)
        // Use a smarter sampling strategy: prioritize points from different runs
        // This preserves the shape better than uniform sampling
        const step = Math.ceil(uniquePoints.length / MAX_POINTS)
        const sampledPoints: Array<{ x: number; z: number; y: number }> = []
        
        // Sample evenly but also include first and last points from each run
        for (let i = 0; i < uniquePoints.length; i += step) {
          sampledPoints.push(uniquePoints[i])
        }
        
        // Ensure we have at least first and last points
        if (uniquePoints.length > 0) {
          if (!sampledPoints.find(p => p === uniquePoints[0])) {
            sampledPoints[0] = uniquePoints[0]
          }
          if (!sampledPoints.find(p => p === uniquePoints[uniquePoints.length - 1])) {
            sampledPoints[sampledPoints.length - 1] = uniquePoints[uniquePoints.length - 1]
          }
        }
        
        uniquePoints.length = 0
        uniquePoints.push(...sampledPoints)
      }

      // Prepare 2D points array for Delaunay (x, z coordinates only)
      const points2D: Array<[number, number]> = uniquePoints.map(point => [point.x, point.z])

      if (points2D.length < 3) {
        console.warn('Not enough points for Delaunay triangulation')
        return
      }

      // Perform Delaunay triangulation
      let delaunay: Delaunator<ArrayLike<number>>
      try {
        delaunay = Delaunator.from(points2D)
      } catch (error) {
        console.error('Delaunay triangulation failed:', error)
        return
      }

      if (!delaunay || !delaunay.triangles || delaunay.triangles.length === 0) {
        console.warn('Delaunay triangulation produced no triangles')
        return
      }
      
      // Build vertices array from uniquePoints
      const vertices: number[] = []
      uniquePoints.forEach(point => {
        vertices.push(point.x, point.y, point.z)
      })
      
      // Extract triangle indices - keep all valid triangles
      // Edge subdivision will handle breaking up long edges later
      const indices: number[] = []
      const pointCount = uniquePoints.length
      
      for (let i = 0; i < delaunay.triangles.length; i += 3) {
        const i0 = delaunay.triangles[i]
        const i1 = delaunay.triangles[i + 1]
        const i2 = delaunay.triangles[i + 2]
        
        // Basic validation only - keep all valid triangles
        if (i0 === undefined || i1 === undefined || i2 === undefined ||
            i0 < 0 || i0 >= pointCount ||
            i1 < 0 || i1 >= pointCount ||
            i2 < 0 || i2 >= pointCount ||
            i0 === i1 || i1 === i2 || i0 === i2) {
          continue
        }
        
        // Keep all valid triangles - edge subdivision will clean up long edges
        indices.push(i0, i1, i2)
      }

      if (indices.length === 0) {
        console.warn('No valid triangles generated')
        return
      }

      // Subdivide long edges to break up straight lines
      // Threshold for edge subdivision - edges longer than this will be subdivided
      const EDGE_SUBDIVISION_THRESHOLD = 3000 // Subdivide edges longer than this
      const MAX_SUBDIVISIONS = 2 // Maximum subdivisions per edge to prevent infinite loops
      
      let currentPoints = [...uniquePoints]
      let currentIndices = [...indices]
      let subdivisionCount = 0
      
      // Keep subdividing until no more long edges or max iterations reached
      while (subdivisionCount < MAX_SUBDIVISIONS) {
        const edgeMap = new Map<string, { v1: number; v2: number; length: number }>()
        const edgeToTriangles = new Map<string, number[]>() // edge key -> array of triangle indices
        
        // Find all long edges and which triangles use them
        for (let i = 0; i < currentIndices.length; i += 3) {
          const v0 = currentIndices[i]
          const v1 = currentIndices[i + 1]
          const v2 = currentIndices[i + 2]
          
          const edges = [
            [Math.min(v0, v1), Math.max(v0, v1)],
            [Math.min(v1, v2), Math.max(v1, v2)],
            [Math.min(v2, v0), Math.max(v2, v0)]
          ]
          
          edges.forEach(([minIdx, maxIdx]) => {
            const key = `${minIdx}-${maxIdx}`
            const p1 = currentPoints[minIdx]
            const p2 = currentPoints[maxIdx]
            const length = Math.sqrt((p2.x - p1.x) ** 2 + (p2.z - p1.z) ** 2)
            
            if (length > EDGE_SUBDIVISION_THRESHOLD) {
              if (!edgeMap.has(key)) {
                edgeMap.set(key, { v1: minIdx, v2: maxIdx, length })
                edgeToTriangles.set(key, [])
              }
              edgeToTriangles.get(key)!.push(i)
            }
          })
        }
        
        if (edgeMap.size === 0) {
          break // No more long edges to subdivide
        }
        
        // Subdivide each long edge
        const newPoints = [...currentPoints]
        const newIndices: number[] = []
        const edgeMidpoints = new Map<string, number>() // edge key -> new midpoint vertex index
        
        // Create midpoints for long edges
        edgeMap.forEach((edge, key) => {
          const p1 = currentPoints[edge.v1]
          const p2 = currentPoints[edge.v2]
          
          // Create midpoint with interpolated elevation
          const midpoint = {
            x: (p1.x + p2.x) / 2,
            y: (p1.y + p2.y) / 2,
            z: (p1.z + p2.z) / 2
          }
          
          const midpointIndex = newPoints.length
          newPoints.push(midpoint)
          edgeMidpoints.set(key, midpointIndex)
        })
        
        // Rebuild triangles, splitting those with subdivided edges
        for (let i = 0; i < currentIndices.length; i += 3) {
          const v0 = currentIndices[i]
          const v1 = currentIndices[i + 1]
          const v2 = currentIndices[i + 2]
          
          const edges: Array<{ key: string; v1: number; v2: number }> = [
            { key: `${Math.min(v0, v1)}-${Math.max(v0, v1)}`, v1: v0, v2: v1 },
            { key: `${Math.min(v1, v2)}-${Math.max(v1, v2)}`, v1: v1, v2: v2 },
            { key: `${Math.min(v2, v0)}-${Math.max(v2, v0)}`, v1: v2, v2: v0 }
          ]
          
          const subdividedEdges = edges.filter(e => edgeMidpoints.has(e.key))
          
          if (subdividedEdges.length === 0) {
            // No subdivided edges, keep triangle as-is
            newIndices.push(v0, v1, v2)
          } else if (subdividedEdges.length === 1) {
            // One edge subdivided - split triangle into 2
            const edge = subdividedEdges[0]
            const vc = edges.find(e => e.key !== edge.key)!.v1 // The vertex not on the subdivided edge
            const midpoint = edgeMidpoints.get(edge.key)!
            
            // Create 2 triangles
            newIndices.push(edge.v1, midpoint, vc)
            newIndices.push(midpoint, edge.v2, vc)
          } else if (subdividedEdges.length === 2) {
            // Two edges subdivided - split into 3 triangles
            // In a triangle, two edges always share a vertex
            const edge1 = subdividedEdges[0]
            const edge2 = subdividedEdges[1]
            const midpoint1 = edgeMidpoints.get(edge1.key)!
            const midpoint2 = edgeMidpoints.get(edge2.key)!
            
            // Find the common vertex where the two subdivided edges meet
            const commonVertex = [edge1.v1, edge1.v2].find(v => v === edge2.v1 || v === edge2.v2)
            
            if (commonVertex === undefined) {
              // This shouldn't happen in a triangle, but fallback to keeping original triangle
              newIndices.push(v0, v1, v2)
              continue
            }
            
            // Find the two non-common vertices (one from each edge)
            const edge1OtherVertex = edge1.v1 === commonVertex ? edge1.v2 : edge1.v1
            const edge2OtherVertex = edge2.v1 === commonVertex ? edge2.v2 : edge2.v1
            
            // The original triangle has vertices: commonVertex, edge1OtherVertex, edge2OtherVertex
            // Create 3 triangles without duplicate vertices:
            // 1. Triangle: commonVertex, midpoint1, midpoint2 (connects common vertex to both midpoints)
            // 2. Triangle: midpoint1, edge1OtherVertex, midpoint2 (connects edge1's other vertex)
            // 3. Triangle: midpoint2, edge2OtherVertex, edge1OtherVertex (connects edge2's other vertex back to edge1's other vertex)
            newIndices.push(commonVertex, midpoint1, midpoint2)
            newIndices.push(midpoint1, edge1OtherVertex, midpoint2)
            newIndices.push(midpoint2, edge2OtherVertex, edge1OtherVertex)
          } else {
            // All 3 edges subdivided - split into 4 triangles
            const midpoints = edges.map(e => edgeMidpoints.get(e.key)!)
            newIndices.push(v0, midpoints[0], midpoints[2])
            newIndices.push(midpoints[0], v1, midpoints[1])
            newIndices.push(midpoints[1], v2, midpoints[2])
            newIndices.push(midpoints[0], midpoints[1], midpoints[2])
          }
        }
        
        currentPoints = newPoints
        currentIndices = newIndices
        subdivisionCount++
      }
      
      // Rebuild vertices array from subdivided points
      const finalVerticesArray: number[] = []
      currentPoints.forEach(point => {
        finalVerticesArray.push(point.x, point.y, point.z)
      })
      
      // Replace the original arrays with subdivided versions
      uniquePoints.length = 0
      uniquePoints.push(...currentPoints)
      vertices.length = 0
      vertices.push(...finalVerticesArray)
      indices.length = 0
      indices.push(...currentIndices)

      // Limit triangle count for performance
      const MAX_TRIANGLES = 25000
      if (indices.length > MAX_TRIANGLES * 3) {
        indices.length = MAX_TRIANGLES * 3
      }
      
      let safeIndices = indices
      let extendedVertices = [...vertices]
      let extendedPoints = [...uniquePoints]
      
      // Extend boundary edges outward if extendEdges > 0
      if (extendEdges > 0) {
        // Find boundary edges (edges that appear only once)
        const edgeCount = new Map<string, number>() // "v1-v2" -> count
        
        for (let i = 0; i < safeIndices.length; i += 3) {
          const v0 = safeIndices[i]
          const v1 = safeIndices[i + 1]
          const v2 = safeIndices[i + 2]
          
          // Count each edge (always use smaller index first)
          const edges = [
            [Math.min(v0, v1), Math.max(v0, v1)],
            [Math.min(v1, v2), Math.max(v1, v2)],
            [Math.min(v2, v0), Math.max(v2, v0)]
          ]
          
          edges.forEach(([minIdx, maxIdx]) => {
            const key = `${minIdx}-${maxIdx}`
            edgeCount.set(key, (edgeCount.get(key) || 0) + 1)
          })
        }
        
        // Find boundary edges (count === 1)
        const boundaryEdges: Array<[number, number]> = []
        edgeCount.forEach((count, key) => {
          if (count === 1) {
            const [v1, v2] = key.split('-').map(Number)
            boundaryEdges.push([v1, v2])
          }
        })
        
        if (boundaryEdges.length > 0) {
          // Calculate center of mesh (average of all points)
          let centerX = 0, centerZ = 0, centerY = 0
          uniquePoints.forEach(p => {
            centerX += p.x
            centerZ += p.z
            centerY += p.y
          })
          centerX /= uniquePoints.length
          centerZ /= uniquePoints.length
          centerY /= uniquePoints.length
          
          // Collect boundary vertices (vertices that are part of boundary edges)
          const boundaryVertices = new Set<number>()
          boundaryEdges.forEach(([v1, v2]) => {
            boundaryVertices.add(v1)
            boundaryVertices.add(v2)
          })
          
          // Extend each boundary vertex outward
          const vertexExtensionMap = new Map<number, number>() // old index -> new index
          boundaryVertices.forEach(vertexIdx => {
            const point = uniquePoints[vertexIdx]
            
            // Calculate direction from center to vertex
            const dx = point.x - centerX
            const dz = point.z - centerZ
            const dist = Math.sqrt(dx * dx + dz * dz)
            
            if (dist > 0) {
              // Normalize and extend
              const extendX = (dx / dist) * extendEdges
              const extendZ = (dz / dist) * extendEdges
              
              // Create extended vertex (same Y elevation)
              const extendedPoint = {
                x: point.x + extendX,
                z: point.z + extendZ,
                y: point.y
              }
              
              const newIndex = extendedPoints.length
              extendedPoints.push(extendedPoint)
              extendedVertices.push(extendedPoint.x, extendedPoint.y, extendedPoint.z)
              vertexExtensionMap.set(vertexIdx, newIndex)
            }
          })
          
          // Create triangles connecting boundary edges to extended vertices
          boundaryEdges.forEach(([v1, v2]) => {
            const extV1 = vertexExtensionMap.get(v1)
            const extV2 = vertexExtensionMap.get(v2)
            
            if (extV1 !== undefined && extV2 !== undefined) {
              // Create quad from original edge to extended edge
              // Triangle 1: v1, v2, extV1
              safeIndices.push(v1, v2, extV1)
              // Triangle 2: v2, extV2, extV1
              safeIndices.push(v2, extV2, extV1)
            }
          })
        }
      }
      
      // Create geometry
      try {
        const geometry = new THREE.BufferGeometry()
        
        // Use extended vertices if edges were extended
        const finalVertices = extendEdges > 0 ? extendedVertices : vertices
        const finalVertexCount = finalVertices.length / 3
        const actualMaxIndex = Math.max(...safeIndices)
        
        if (actualMaxIndex >= finalVertexCount) {
          console.error('Terrain mesh: Index out of bounds')
          return
        }
        
        // If thickness > 0, create extruded geometry with top, bottom, and sides
        if (thickness > 0) {
          const topVertexCount = finalVertexCount
          const allVertices: number[] = []
          const allIndices: number[] = []
          
          // 1. Add top surface vertices (original or extended vertices)
          allVertices.push(...finalVertices)
          
          // 2. Add bottom surface vertices (offset downward by thickness)
          const pointsToUse = extendEdges > 0 ? extendedPoints : uniquePoints
          pointsToUse.forEach(point => {
            allVertices.push(point.x, point.y - thickness, point.z)
          })
          
          // 3. Add top surface indices (original, but ensure correct winding)
          safeIndices.forEach((idx, i) => {
            if (i % 3 === 0) {
              // For each triangle, add it to top surface
              allIndices.push(safeIndices[i], safeIndices[i + 1], safeIndices[i + 2])
            }
          })
          
          // 4. Add bottom surface indices (reversed winding for bottom face)
          safeIndices.forEach((idx, i) => {
            if (i % 3 === 0) {
              // Reverse winding for bottom face
              allIndices.push(
                topVertexCount + safeIndices[i + 2],
                topVertexCount + safeIndices[i + 1],
                topVertexCount + safeIndices[i]
              )
            }
          })
          
          // 5. Add side faces (connect top and bottom edges)
          // We need to find edges that are part of the boundary
          // For simplicity, we'll create side faces for all triangle edges
          // This creates some duplicate faces but ensures complete coverage
          const edgeMap = new Map<string, number[]>() // "v1-v2" -> [v1, v2, triangleIndex]
          
          // Collect all edges from triangles
          for (let i = 0; i < safeIndices.length; i += 3) {
            const v0 = safeIndices[i]
            const v1 = safeIndices[i + 1]
            const v2 = safeIndices[i + 2]
            
            // Create edges (always use smaller index first for consistency)
            const edges = [
              [Math.min(v0, v1), Math.max(v0, v1)],
              [Math.min(v1, v2), Math.max(v1, v2)],
              [Math.min(v2, v0), Math.max(v2, v0)]
            ]
            
            edges.forEach(([minIdx, maxIdx]) => {
              const key = `${minIdx}-${maxIdx}`
              if (!edgeMap.has(key)) {
                edgeMap.set(key, [minIdx, maxIdx])
              }
            })
          }
          
          // Create side faces for each edge
          edgeMap.forEach((edge) => {
            const [vTop1, vTop2] = edge
            const vBottom1 = topVertexCount + vTop1
            const vBottom2 = topVertexCount + vTop2
            
            // Create two triangles for the quad (side face)
            // Triangle 1: vTop1, vTop2, vBottom1
            allIndices.push(vTop1, vTop2, vBottom1)
            // Triangle 2: vTop2, vBottom2, vBottom1
            allIndices.push(vTop2, vBottom2, vBottom1)
          })
          
          geometry.setAttribute('position', new THREE.Float32BufferAttribute(allVertices, 3))
          geometry.setIndex(allIndices)
        } else {
          // Flat mesh (original or extended behavior)
          geometry.setAttribute('position', new THREE.Float32BufferAttribute(finalVertices, 3))
        geometry.setIndex(safeIndices)
        }
        
        // Compute normals for proper lighting response
        geometry.computeVertexNormals()
        
        // Add vertex colors based on normals (peaks/edges will have different colors)
        const positions = geometry.attributes.position
        const normals = geometry.attributes.normal
        const vertexCount = positions.count
        const colors: number[] = []
        
        // Parse base color and edge color
        const baseColor = new THREE.Color(color)
        const edgeColorObj = new THREE.Color(edgeColor)
        
        // Calculate elevation range for normalization
        let minY = Infinity
        let maxY = -Infinity
        for (let i = 0; i < vertexCount; i++) {
          const y = positions.getY(i)
          minY = Math.min(minY, y)
          maxY = Math.max(maxY, y)
        }
        const elevationRange = maxY - minY
        
        // Calculate thresholds - only apply edge color to very pointy/edge-like vertices
        const peakThreshold = 0.85 // Only top 15% of peaks get edge color
        const edgeThreshold = 0.9 // Only very sharp edges get edge color
        
        // First pass: collect all factors to find thresholds
        const peakFactors: number[] = []
        const edgeFactors: number[] = []
        
        for (let i = 0; i < vertexCount; i++) {
          const nx = normals.getX(i)
          const ny = normals.getY(i)
          const nz = normals.getZ(i)
          const y = positions.getY(i)
          
          // Calculate peak factor (vertical normal + high elevation)
          const verticalNormal = Math.max(0, ny)
          const elevationFactor = elevationRange > 0 
            ? (y - minY) / elevationRange
            : 0
          const peakFactor = verticalNormal * 0.7 + elevationFactor * 0.3
          
          // Calculate edge factor (horizontal deviation)
          const horizontalDeviation = Math.sqrt(nx * nx + nz * nz)
          const edgeFactor = horizontalDeviation
          
          peakFactors.push(peakFactor)
          edgeFactors.push(edgeFactor)
        }
        
        // Find percentile thresholds
        const sortedPeaks = [...peakFactors].sort((a, b) => b - a)
        const sortedEdges = [...edgeFactors].sort((a, b) => b - a)
        const peakThresholdValue = sortedPeaks[Math.floor(sortedPeaks.length * (1 - peakThreshold))]
        const edgeThresholdValue = sortedEdges[Math.floor(sortedEdges.length * (1 - edgeThreshold))]
        
        // Second pass: apply colors only to vertices above thresholds
        for (let i = 0; i < vertexCount; i++) {
          const peakFactor = peakFactors[i]
          const edgeFactor = edgeFactors[i]
          
          // Only apply edge color if vertex is above threshold
          const isPeak = peakFactor >= peakThresholdValue
          const isEdge = edgeFactor >= edgeThresholdValue
          
          let edgeColorFactor = 0
          if (isPeak || isEdge) {
            // Calculate how far above threshold (0-1)
            const peakIntensity = isPeak 
              ? Math.min(1, (peakFactor - peakThresholdValue) / (1 - peakThresholdValue))
              : 0
            const edgeIntensity = isEdge
              ? Math.min(1, (edgeFactor - edgeThresholdValue) / (1 - edgeThresholdValue))
              : 0
            
            // Use the maximum intensity, but keep it subtle
            edgeColorFactor = Math.min(1, Math.max(peakIntensity, edgeIntensity) * 0.8)
          }
          
          // Interpolate between base color and edge color
          const mixedColor = baseColor.clone().lerp(edgeColorObj, edgeColorFactor)
          
          colors.push(mixedColor.r, mixedColor.g, mixedColor.b)
        }
        
        geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
        
        setTerrainGeometry(geometry)
        
        // Notify parent that geometry is ready for export
        if (onGeometryReady) {
          onGeometryReady(geometry)
        }

        return () => {
          geometry.dispose()
        }
      } catch (error) {
        console.error('Error creating terrain geometry:', error)
        setTerrainGeometry(null)
      }
    } catch (error) {
      console.error('Error creating terrain mesh:', error)
      setTerrainGeometry(null)
    }
  }, [skiFeatures, center, elevationScale, bounds, elevationOffset, tubeRadius, thickness, extendEdges, color, edgeColor])

  if (!show || !terrainGeometry) return null

  const finalOpacity = Math.max(0.1, animatedOpacity)

  return (
    <mesh geometry={terrainGeometry} renderOrder={-1}>
      <meshBasicMaterial
        color={wireframe ? '#ff0000' : color}
        transparent={finalOpacity < 1}
        opacity={finalOpacity}
        wireframe={wireframe}
        side={THREE.DoubleSide} // Render both sides - visible from top and bottom
        depthWrite={true}
        depthTest={true}
        vertexColors={!wireframe} // Use vertex colors when not in wireframe mode
      />
    </mesh>
  )
}

// Component to render imported mesh from OBJ file
function ImportedTerrainMesh({
  geometry,
  opacity = 1,
  wireframe = false,
  color = '#ffffff',
  edgeColor = '#888888'
}: {
  geometry: THREE.BufferGeometry
  opacity?: number
  wireframe?: boolean
  color?: string
  edgeColor?: string
}) {
  const finalOpacity = Math.max(0.1, opacity)
  
  useEffect(() => {
    console.log('ImportedTerrainMesh rendering:', {
      vertexCount: geometry.attributes.position?.count || 0,
      faceCount: geometry.index?.count ? geometry.index.count / 3 : 0,
      hasNormals: !!geometry.attributes.normal,
      hasColors: !!geometry.attributes.color
    })
  }, [geometry])
  
  // Update vertex colors if needed
  useEffect(() => {
    if (!wireframe && geometry.attributes.color) {
      const baseColor = new THREE.Color(color)
      const edgeColorObj = new THREE.Color(edgeColor)
      const colors = geometry.attributes.color.array as Float32Array
      
      // Update colors based on normals (similar to generated mesh)
      if (geometry.attributes.normal) {
        const normals = geometry.attributes.normal
        const vertexCount = geometry.attributes.position.count
        
        for (let i = 0; i < vertexCount; i++) {
          const nx = normals.getX(i)
          const ny = normals.getY(i)
          const nz = normals.getZ(i)
          
          // Simple peak/edge detection
          const verticalNormal = Math.max(0, ny)
          const horizontalDeviation = Math.sqrt(nx * nx + nz * nz)
          const edgeFactor = Math.min(1, (verticalNormal * 0.6 + horizontalDeviation * 0.4) * 0.8)
          
          const mixedColor = baseColor.clone().lerp(edgeColorObj, edgeFactor)
          colors[i * 3] = mixedColor.r
          colors[i * 3 + 1] = mixedColor.g
          colors[i * 3 + 2] = mixedColor.b
        }
        
        geometry.attributes.color.needsUpdate = true
      }
    }
  }, [geometry, color, edgeColor, wireframe])
  
  return (
    <mesh geometry={geometry} renderOrder={-1}>
      <meshBasicMaterial
        color={wireframe ? '#ff0000' : color}
        transparent={finalOpacity < 1}
        opacity={finalOpacity}
        wireframe={wireframe}
        side={THREE.DoubleSide}
        depthWrite={true}
        depthTest={true}
        vertexColors={!wireframe}
      />
    </mesh>
  )
}

// Component to set scene background color
function SceneBackground({ color }: { color: string }) {
  const { scene } = useThree()
  useEffect(() => {
    scene.background = new THREE.Color(color)
  }, [scene, color])
  return null
}

// Calculate highest point from ski features
function useHighestPoint(
  skiFeatures: SkiFeature[],
  center: [number, number],
  elevationScale: number
): THREE.Vector3 | null {
  const [highestPoint, setHighestPoint] = useState<THREE.Vector3 | null>(null)

  useEffect(() => {
    try {
      let maxY = -Infinity
      let highestPointVec: THREE.Vector3 | null = null

      skiFeatures.forEach(feature => {
        if (!feature.geometry || !feature.geometry.coordinates) return

        const coords = feature.geometry.type === 'LineString'
          ? feature.geometry.coordinates
          : feature.geometry.type === 'MultiLineString'
            ? feature.geometry.coordinates.flat()
            : []

        // Use EXACT same elevation extraction logic as SimpleTrail3D
        let hasElevation = false
        coords.forEach((coord: number[]) => {
          if (coord && coord.length > 2 && coord[2] !== undefined && coord[2] !== null && !isNaN(coord[2])) {
            hasElevation = true
          }
        })

        // Determine elevation to use (same logic as trails)
        let elevationToUse: number | null = null
        
        if (!hasElevation) {
          const metadata = feature.metadata
          const metadataElevation = extractElevationFromMetadata(metadata)
          
          if (metadataElevation !== null && typeof metadataElevation === 'number' && !isNaN(metadataElevation)) {
            elevationToUse = metadataElevation
          } else if (metadata?.elevation_min !== undefined || metadata?.elevation_max !== undefined) {
            const min = typeof metadata.elevation_min === 'number' ? metadata.elevation_min : 0
            const max = typeof metadata.elevation_max === 'number' ? metadata.elevation_max : 0
            elevationToUse = (min + max) / 2
          } else if (metadata?.elevation_avg !== undefined && typeof metadata.elevation_avg === 'number') {
            elevationToUse = metadata.elevation_avg
          }
        }

        coords.forEach((coord: number[]) => {
          if (!coord || coord.length < 2) return
          
          const lng = coord[0]
          const lat = coord[1]
          if (isNaN(lng) || isNaN(lat) || !isFinite(lng) || !isFinite(lat)) {
            return
          }
          
          const elevation = coord.length > 2 && coord[2] !== undefined && coord[2] !== null && !isNaN(coord[2])
            ? coord[2]
            : elevationToUse !== null && !isNaN(elevationToUse)
              ? elevationToUse
              : 0
          
          try {
            const [x, y, z] = geoJsonToSimpleSceneCoords([lng, lat, elevation], center, elevationScale)
            
            if (isNaN(x) || isNaN(y) || isNaN(z) || !isFinite(x) || !isFinite(y) || !isFinite(z)) {
              return
            }
            
            // Track the highest point (maximum Y/elevation)
            if (y > maxY) {
              maxY = y
              highestPointVec = new THREE.Vector3(x, y, z)
            }
          } catch (err) {
            // Skip invalid coordinates
          }
        })
      })

      setHighestPoint(highestPointVec)
    } catch (error) {
      console.error('Error calculating highest point:', error)
      setHighestPoint(null)
    }
  }, [skiFeatures, center, elevationScale])

  return highestPoint
}

// Component that calculates highest and lowest points and positions axes
// X and Z axes at lowest elevation, Y axis vertical from lowest to highest
function AxesAtHighestPoint({
  show = true,
  size = 50000,
  skiFeatures,
  center,
  elevationScale
}: {
  show?: boolean
  size?: number
  skiFeatures: SkiFeature[]
  center: [number, number]
  elevationScale: number
}) {
  const [highestPoint, setHighestPoint] = useState<THREE.Vector3 | null>(null)
  const [lowestPoint, setLowestPoint] = useState<THREE.Vector3 | null>(null)

  useEffect(() => {
    if (!show) {
      setHighestPoint(null)
      setLowestPoint(null)
      return
    }

    try {
      let maxY = -Infinity
      let minY = Infinity
      let highestPointVec: THREE.Vector3 | null = null
      let lowestPointVec: THREE.Vector3 | null = null

      skiFeatures.forEach(feature => {
        if (!feature.geometry || !feature.geometry.coordinates) return

        const coords = feature.geometry.type === 'LineString'
          ? feature.geometry.coordinates
          : feature.geometry.type === 'MultiLineString'
            ? feature.geometry.coordinates.flat()
            : []

        // Use EXACT same elevation extraction logic as SimpleTrail3D
        let hasElevation = false
        coords.forEach((coord: number[]) => {
          if (coord && coord.length > 2 && coord[2] !== undefined && coord[2] !== null && !isNaN(coord[2])) {
            hasElevation = true
          }
        })

        // Determine elevation to use (same logic as trails)
        let elevationToUse: number | null = null
        
        if (!hasElevation) {
          const metadata = feature.metadata
          const metadataElevation = extractElevationFromMetadata(metadata)
          
          if (metadataElevation !== null && typeof metadataElevation === 'number' && !isNaN(metadataElevation)) {
            elevationToUse = metadataElevation
          } else if (metadata?.elevation_min !== undefined || metadata?.elevation_max !== undefined) {
            const min = typeof metadata.elevation_min === 'number' ? metadata.elevation_min : 0
            const max = typeof metadata.elevation_max === 'number' ? metadata.elevation_max : 0
            elevationToUse = (min + max) / 2
          } else if (metadata?.elevation_avg !== undefined && typeof metadata.elevation_avg === 'number') {
            elevationToUse = metadata.elevation_avg
          }
        }

        coords.forEach((coord: number[]) => {
          if (!coord || coord.length < 2) return
          
          const lng = coord[0]
          const lat = coord[1]
          if (isNaN(lng) || isNaN(lat) || !isFinite(lng) || !isFinite(lat)) {
            return
          }
          
          const elevation = coord.length > 2 && coord[2] !== undefined && coord[2] !== null && !isNaN(coord[2])
            ? coord[2]
            : elevationToUse !== null && !isNaN(elevationToUse)
              ? elevationToUse
              : 0
          
          try {
            const [x, y, z] = geoJsonToSimpleSceneCoords([lng, lat, elevation], center, elevationScale)
            
            if (isNaN(x) || isNaN(y) || isNaN(z) || !isFinite(x) || !isFinite(y) || !isFinite(z)) {
              return
            }
            
            // Track the highest point (maximum Y/elevation)
            if (y > maxY) {
              maxY = y
              highestPointVec = new THREE.Vector3(x, y, z)
            }
            
            // Track the lowest point (minimum Y/elevation)
            if (y < minY) {
              minY = y
              lowestPointVec = new THREE.Vector3(x, y, z)
            }
          } catch (err) {
            // Skip invalid coordinates
          }
        })
      })

      setHighestPoint(highestPointVec)
      setLowestPoint(lowestPointVec)
    } catch (error) {
      console.error('Error calculating highest/lowest points for axes:', error)
      setHighestPoint(null)
      setLowestPoint(null)
    }
  }, [show, skiFeatures, center, elevationScale])

  if (!show || !highestPoint || !lowestPoint) return null

  // All axes share the same X and Y position (from highest point)
  // X, Y, and Z axes are all at lowest elevation
  const axesOrigin = new THREE.Vector3(highestPoint.x, lowestPoint.y, highestPoint.z) // Same X,Y as highest, but at lowest elevation

  return (
    <>
      {/* X-axis (red) - horizontal, at lowest elevation, same X,Y as highest point */}
      <arrowHelper
        args={[
          new THREE.Vector3(1, 0, 0), // direction
          axesOrigin, // origin at lowest elevation, same X,Y as highest point
          size, // length
          0xff0000, // color (red)
          size * 0.02, // head length
          size * 0.015 // head width
        ]}
      />
      {/* Y-axis (green) - vertical, at lowest elevation, same X,Y as highest point */}
      <arrowHelper
        args={[
          new THREE.Vector3(0, 1, 0), // direction
          axesOrigin, // origin at lowest elevation, same X,Y as highest point
          size, // length
          0x00ff00, // color (green)
          size * 0.02, // head length
          size * 0.015 // head width
        ]}
      />
      {/* Z-axis (blue) - horizontal, at lowest elevation, same X,Y as highest point */}
      <arrowHelper
        args={[
          new THREE.Vector3(0, 0, 1), // direction
          axesOrigin, // origin at lowest elevation, same X,Y as highest point
          size, // length
          0x0000ff, // color (blue)
          size * 0.02, // head length
          size * 0.015 // head width
        ]}
      />
    </>
  )
}

// Terrain mesh type options
export type TerrainMeshType = 'none' | 'delaunay'

// REMOVED: All unused terrain mesh functions and helpers
// (PointCloudTerrain, collectTerrainPoints, HeightmapGridTerrain, GridNearestTerrain, 
//  GridBilinearTerrain, VoronoiTerrain, ConvexHullTerrain, TubeTrails, RibbonTrails, 
//  calculateAlphaShapeBoundary, SimplifiedBoundary, VoronoiCellSizeCalculator)

// Main scene component with mesh type selector
function SimpleScene3D({
  skiFeatures,
  center,
  elevationScale,
  bounds,
  terrainConfig,
  terrainMeshType = 'none',
  terrainOpacity = 1,
  terrainWireframe = false,
  terrainColor = '#ffffff',
  terrainThickness = 0,
  terrainExtendEdges = 0,
  terrainEdgeColor = '#888888',
  onTerrainGeometryReady,
  importedMeshGeometry = null
}: {
  skiFeatures: SkiFeature[]
  center: [number, number]
  elevationScale: number
  bounds: { minLat: number; maxLat: number; minLng: number; maxLng: number }
  terrainConfig?: {
    elevationOffset?: number
  }
  terrainMeshType?: TerrainMeshType
  terrainOpacity?: number
  terrainWireframe?: boolean
  terrainColor?: string
  terrainThickness?: number
  terrainExtendEdges?: number
  terrainEdgeColor?: string
  onTerrainGeometryReady?: (geometry: THREE.BufferGeometry) => void
  importedMeshGeometry?: THREE.BufferGeometry | null
}) {
  // Filter to show trails, lifts, and boundaries
  let features = skiFeatures.filter(f => f.type === 'trail' || f.type === 'lift' || f.type === 'boundary')

  // Limit number of features to prevent WebGL context loss
  const MAX_FEATURES = 500
  if (features.length > MAX_FEATURES) {
    console.warn(`Too many features (${features.length}), limiting to ${MAX_FEATURES} to prevent WebGL context loss`)
    features = features.slice(0, MAX_FEATURES)
  }

  if (features.length === 0) {
    return (
      <group>
        <Billboard position={[0, 100, 0]} follow={true}>
          <mesh position={[0, 0, -0.5]}>
            <planeGeometry args={[200, 40]} />
            <meshBasicMaterial color="#ffffff" transparent opacity={0.9} />
          </mesh>
          <Text
            fontSize={8}
            color="#6b7280"
            anchorX="center"
            anchorY="middle"
            fontWeight="bold"
          >
            No trails, lifts, or boundaries available
          </Text>
        </Billboard>
      </group>
    )
  }

  return (
    <>
      {/* Render trails, lifts, and boundaries as lines */}
      {features.map((feature) => (
        <SimpleTrail3D
          key={`${feature.type}-${feature.id}`}
          feature={feature}
          center={center}
          elevationScale={elevationScale}
        />
      ))}
      
      {/* Render imported mesh if available, otherwise render generated mesh */}
      {importedMeshGeometry ? (
        <ImportedTerrainMesh
          key="imported-mesh"
          geometry={importedMeshGeometry}
          opacity={terrainOpacity}
          wireframe={terrainWireframe}
          color={terrainColor}
          edgeColor={terrainEdgeColor}
        />
      ) : (
        terrainMeshType === 'delaunay' && (
          <SimpleTerrainMesh
            skiFeatures={skiFeatures}
            center={center}
            elevationScale={elevationScale}
            bounds={bounds}
            elevationOffset={terrainConfig?.elevationOffset || 0}
            tubeRadius={6}
            show={true}
            opacity={terrainOpacity}
            wireframe={terrainWireframe}
            color={terrainColor}
            thickness={terrainThickness}
            extendEdges={terrainExtendEdges}
            edgeColor={terrainEdgeColor}
            onGeometryReady={onTerrainGeometryReady}
          />
        )
      )}
    </>
  )
}

export default function SimpleMap3D({
  skiFeatures,
  resortName = 'Resort',
  terrainConfig
}: SimpleMap3DProps) {
  const controlsRef = useRef<any>(null)
  const [showFocusPlane, setShowFocusPlane] = useState(false)
  const [showAxes, setShowAxes] = useState(true)
  const [terrainMeshType, setTerrainMeshType] = useState<TerrainMeshType>('delaunay') // Default to delaunay for visibility
  const [terrainOpacity, setTerrainOpacity] = useState(1) // Fully opaque white
  const [terrainWireframe, setTerrainWireframe] = useState(false)
  const [terrainColor, setTerrainColor] = useState('#ffffff') // White
  const [terrainThickness, setTerrainThickness] = useState(0) // Thickness of terrain mesh
  const [terrainExtendEdges, setTerrainExtendEdges] = useState(0) // Distance to extend edges outward
  const [terrainEdgeColor, setTerrainEdgeColor] = useState('#888888') // Grey for peaks/edges
  const terrainGeometryRef = useRef<THREE.BufferGeometry | null>(null)
  const [importedMeshGeometry, setImportedMeshGeometry] = useState<THREE.BufferGeometry | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  
  // Function to import mesh from OBJ format
  const importMeshFromOBJ = (file: File) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const objContent = e.target?.result as string
        if (!objContent) {
          alert('Failed to read OBJ file')
          return
        }
        
        // Parse OBJ file
        const lines = objContent.split('\n')
        const vertices: number[] = []
        const faces: number[] = []
        
        let vertexCount = 0
        let faceLineCount = 0
        let skippedFaces = 0
        
        for (const line of lines) {
          const trimmed = line.trim()
          if (trimmed.startsWith('v ')) {
            // Vertex: v x y z
            const parts = trimmed.split(/\s+/)
            if (parts.length >= 4) {
              const x = parseFloat(parts[1])
              const y = parseFloat(parts[2])
              const z = parseFloat(parts[3])
              if (!isNaN(x) && !isNaN(y) && !isNaN(z)) {
                vertices.push(x, y, z)
                vertexCount++
              }
            }
          } else if (trimmed.startsWith('f ')) {
            // Face: f v1 v2 v3 [v4] (OBJ uses 1-based indexing, can be negative for relative)
            const parts = trimmed.split(/\s+/).filter(p => p.length > 0)
            if (parts.length >= 4) {
              // Extract vertex indices (handle formats: "f 1 2 3", "f 1/1/1 2/2/2 3/3/3", "f -1 -2 -3")
              const parseVertexIndex = (part: string): number | null => {
                const vertexPart = part.split('/')[0].trim()
                if (!vertexPart) return null
                
                let index = parseInt(vertexPart)
                if (isNaN(index)) return null
                
                // Handle negative indices (relative to end of vertex list)
                if (index < 0) {
                  index = vertices.length / 3 + index + 1 // +1 because OBJ is 1-based
                }
                
                // Convert to 0-based and validate
                const zeroBased = index - 1
                if (zeroBased < 0 || zeroBased >= vertices.length / 3) {
                  console.warn(`Invalid vertex index: ${index} (max: ${vertices.length / 3})`)
                  return null
                }
                
                return zeroBased
              }
              
              const vertexIndices: number[] = []
              for (let i = 1; i < parts.length; i++) {
                const idx = parseVertexIndex(parts[i])
                if (idx !== null) {
                  vertexIndices.push(idx)
                }
              }
              
              // Triangulate faces (handle quads and n-gons)
              if (vertexIndices.length >= 3) {
                // Triangulate: for n vertices, create n-2 triangles
                for (let i = 1; i < vertexIndices.length - 1; i++) {
                  faces.push(vertexIndices[0], vertexIndices[i], vertexIndices[i + 1])
                }
                faceLineCount++
              } else {
                skippedFaces++
              }
            } else {
              skippedFaces++
            }
          }
        }
        
        if (vertices.length === 0) {
          alert('No vertices found in OBJ file')
          return
        }
        
        if (faces.length === 0) {
          alert('No faces found in OBJ file')
          return
        }
        
        console.log('OBJ Import Summary:', {
          vertices: vertexCount,
          faceLines: faceLineCount,
          triangles: faces.length / 3,
          skippedFaces: skippedFaces
        })
        
        // Create BufferGeometry from imported mesh
        const geometry = new THREE.BufferGeometry()
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3))
        geometry.setIndex(faces)
        geometry.computeVertexNormals()
        
        // Add vertex colors if needed (using current color settings)
        const baseColor = new THREE.Color(terrainColor)
        const edgeColorObj = new THREE.Color(terrainEdgeColor)
        const colors: number[] = []
        
        // Simple color assignment - you can enhance this later
        for (let i = 0; i < vertices.length / 3; i++) {
          // For imported mesh, use base color by default
          colors.push(baseColor.r, baseColor.g, baseColor.b)
        }
        geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
        
        // Ensure terrain mesh type is set to show the mesh
        if (terrainMeshType === 'none') {
          setTerrainMeshType('delaunay')
        }
        
        setImportedMeshGeometry(geometry)
        terrainGeometryRef.current = geometry
        
        console.log('Mesh imported:', {
          vertices: vertices.length / 3,
          faces: faces.length / 3,
          hasGeometry: !!geometry,
          positionCount: geometry.attributes.position?.count || 0,
          indexCount: geometry.index?.count || 0
        })
        
        alert(`Mesh imported successfully!\nVertices: ${vertices.length / 3}\nFaces: ${faces.length / 3}\n\nThe imported mesh should now be visible.`)
      } catch (error) {
        console.error('Error importing OBJ:', error)
        alert(`Error importing OBJ file: ${error}`)
      }
    }
    reader.onerror = () => {
      alert('Failed to read file')
    }
    reader.readAsText(file)
  }
  
  // Function to export mesh to OBJ format
  const exportMeshToOBJ = () => {
    if (!terrainGeometryRef.current) {
      alert('No terrain mesh available to export. Please enable the terrain mesh first.')
      return
    }
    
    const geometry = terrainGeometryRef.current
    const positions = geometry.attributes.position
    const indices = geometry.index
    
    if (!positions || !indices) {
      alert('Mesh geometry is incomplete. Cannot export.')
      return
    }
    
    // Build OBJ file content
    let objContent = `# Terrain Mesh Export\n`
    objContent += `# Generated from SimpleMap3D\n`
    objContent += `# Vertices: ${positions.count}, Faces: ${indices.count / 3}\n\n`
    
    // Write vertices (OBJ uses 1-based indexing)
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i)
      const y = positions.getY(i)
      const z = positions.getZ(i)
      objContent += `v ${x} ${y} ${z}\n`
    }
    
    objContent += `\n`
    
    // Write faces (OBJ uses 1-based indexing)
    const indexArray = indices.array
    for (let i = 0; i < indices.count; i += 3) {
      const v1 = indexArray[i] + 1
      const v2 = indexArray[i + 1] + 1
      const v3 = indexArray[i + 2] + 1
      objContent += `f ${v1} ${v2} ${v3}\n`
    }
    
    // Create download
    const blob = new Blob([objContent], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `terrain-mesh-${resortName || 'export'}-${Date.now()}.obj`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
    
    alert(`Mesh exported! Import into Blender with:\n- Forward: -Z\n- Up: Y\n\nAfter editing, export with same settings.`)
  }
  
  const terrainMeshTypes: { value: TerrainMeshType; label: string }[] = [
    { value: 'none', label: 'None' },
    { value: 'delaunay', label: 'Delaunay Triangulation' },
  ]
  
  // Calculate scene center and bounds
  const { center, bounds } = useMemo(() => calculateSceneBounds(skiFeatures), [skiFeatures])
  
  // Calculate elevation scale based on bounds to make elevation visible
  // This ensures elevation changes are visible relative to the horizontal extent
  const elevationScale = useMemo(() => {
    const latRange = bounds.maxLat - bounds.minLat
    const lngRange = bounds.maxLng - bounds.minLng
    const spatialRange = Math.max(latRange, lngRange) * 111320 // Convert to meters (approx meters per degree)
    
    // Calculate typical elevation range for ski resorts (500-2000m)
    // Scale elevation to be proportionally visible - make elevation changes 2-3x more prominent
    // This helps visualize the mountain shape through the runs
    const typicalElevationRange = 1500 // meters
    const scaleFactor = spatialRange > 0 ? (spatialRange / typicalElevationRange) * 2 : 1
    
    return Math.max(0.5, Math.min(scaleFactor, 5)) // Clamp between 0.5 and 5
  }, [bounds])

  return (
    <div className="relative w-full h-full" style={{ width: '100%', height: '100%', backgroundColor: '#ffffff', position: 'absolute', top: 0, left: 0 }}>
      <Canvas 
        shadows={true}
        flat
        gl={{ 
          antialias: true,
          powerPreference: 'high-performance',
          stencil: false,
          depth: true,
          alpha: false,
          preserveDrawingBuffer: false,
        }}
        dpr={1}
        style={{ width: '100%', height: '100%', display: 'block' }}
        onCreated={({ gl }) => {
          // Handle WebGL context loss
          gl.domElement.addEventListener('webglcontextlost', (event) => {
            event.preventDefault()
            console.warn('WebGL context lost, attempting to restore...')
          })
          gl.domElement.addEventListener('webglcontextrestored', () => {
            console.log('WebGL context restored')
          })
        }}
      >
        {/* Set scene background to white */}
        <SceneBackground color="#ffffff" />
        
        {/* Axes helpers - X (red), Y (green), Z (blue) - positioned at highest point */}
        <AxesAtHighestPoint 
          show={showAxes} 
          size={50000}
          skiFeatures={skiFeatures}
          center={center}
          elevationScale={elevationScale}
        />
        
        {/* Soft, even lighting - no shadows or shininess */}
        <ambientLight intensity={1.0} />
        
        {/* Camera */}
        <PerspectiveCamera makeDefault position={[0, 1000, 1000]} fov={60} near={10} far={100000} />
        <OrbitControls
          ref={controlsRef}
          enablePan={true}
          enableZoom={true}
          enableRotate={true}
          minDistance={100}
          maxDistance={50000}
          target={[0, 0, 0]}
          screenSpacePanning={true}
        />
        
        {/* Scene with terrain and trails */}
        <SimpleScene3D
          skiFeatures={skiFeatures}
          center={center}
          elevationScale={elevationScale}
          bounds={bounds}
          terrainConfig={terrainConfig}
          terrainMeshType={terrainMeshType}
          terrainOpacity={terrainOpacity}
          terrainWireframe={terrainWireframe}
          terrainColor={terrainColor}
          terrainThickness={terrainThickness}
          terrainExtendEdges={terrainExtendEdges}
          terrainEdgeColor={terrainEdgeColor}
          onTerrainGeometryReady={(geometry) => {
            terrainGeometryRef.current = geometry
          }}
          importedMeshGeometry={importedMeshGeometry}
        />
        
        {/* Auto-position camera based on trails */}
        <CameraController 
          skiFeatures={skiFeatures} 
          center={center}
          controlsRef={controlsRef}
          elevationScale={elevationScale}
          screenTargetPosition={[0.5, 0.1]}
        />
        
        {/* Depth of Field Effect - DISABLED for performance */}
        {/* <DepthOfFieldController controlsRef={controlsRef} showFocusPlane={showFocusPlane} /> */}
      </Canvas>

       {/* Instructions */}
       <div className="absolute bottom-4 left-4 z-10 bg-white/90 rounded-lg shadow-lg p-3 max-w-xs max-h-[80vh] overflow-y-auto">
         <p className="text-xs text-gray-600">
           <strong>Controls:</strong> Click and drag to rotate, scroll to zoom, right-click to move pivot point
         </p>
        {resortName && (
          <p className="text-xs text-gray-500 mt-1">{resortName}</p>
        )}
        <div className="mt-2 space-y-2">
          <label className="flex items-center gap-2 text-xs cursor-pointer">
            <input
              type="checkbox"
              checked={showAxes}
              onChange={(e) => setShowAxes(e.target.checked)}
              className="w-3 h-3"
            />
            <span>Show Axes (X=red, Y=green, Z=blue)</span>
          </label>
          
          <div className="border-t border-gray-200 pt-2">
            <label className="block text-xs font-semibold mb-1">Terrain Mesh:</label>
            <select
              value={terrainMeshType}
              onChange={(e) => setTerrainMeshType(e.target.value as TerrainMeshType)}
              className="w-full text-xs p-1 border border-gray-300 rounded"
            >
              {terrainMeshTypes.map((type) => (
                <option key={type.value} value={type.value}>
                  {type.label}
                </option>
              ))}
            </select>
            
            {terrainMeshType !== 'none' && (
              <>
                <div className="mt-2 mb-2">
                  <label className="block text-xs mb-1">
                    Opacity: {(terrainOpacity * 100).toFixed(0)}%
                  </label>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.1"
                    value={terrainOpacity}
                    onChange={(e) => setTerrainOpacity(parseFloat(e.target.value))}
                    className="w-full"
                  />
                </div>
                <label className="flex items-center gap-2 text-xs cursor-pointer">
                  <input
                    type="checkbox"
                    checked={terrainWireframe}
                    onChange={(e) => setTerrainWireframe(e.target.checked)}
                    className="w-3 h-3"
                  />
                  <span>Wireframe Mode</span>
                </label>
                <div className="mt-2">
                  <label className="block text-xs mb-1">
                    Base Color:
                  </label>
                  <input
                    type="color"
                    value={terrainColor}
                    onChange={(e) => setTerrainColor(e.target.value)}
                    className="w-full h-6 cursor-pointer"
                  />
                </div>
                <div className="mt-2">
                  <label className="block text-xs mb-1">
                    Edge/Peak Color:
                  </label>
                  <input
                    type="color"
                    value={terrainEdgeColor}
                    onChange={(e) => setTerrainEdgeColor(e.target.value)}
                    className="w-full h-6 cursor-pointer"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Color for peaks, ridges, and pointy parts
                  </p>
                </div>
                <div className="mt-2">
                  <label className="block text-xs mb-1">
                    Thickness: {terrainThickness.toFixed(0)} units
                  </label>
                  <input
                    type="range"
                    min="0"
                    max="1000"
                    step="10"
                    value={terrainThickness}
                    onChange={(e) => setTerrainThickness(parseFloat(e.target.value))}
                    className="w-full"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    {terrainThickness === 0 ? 'Flat surface' : 'Extruded downward'}
                  </p>
                </div>
                <div className="mt-2">
                  <label className="block text-xs mb-1">
                    Extend Edges: {terrainExtendEdges.toFixed(0)} units
                  </label>
                  <input
                    type="range"
                    min="0"
                    max="5000"
                    step="50"
                    value={terrainExtendEdges}
                    onChange={(e) => setTerrainExtendEdges(parseFloat(e.target.value))}
                    className="w-full"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    {terrainExtendEdges === 0 ? 'Original boundaries' : 'Extended outward for infinite look'}
                  </p>
                </div>
                <div className="mt-3 pt-2 border-t border-gray-200">
                  <div className="space-y-2">
                    <button
                      onClick={exportMeshToOBJ}
                      className="w-full px-3 py-2 text-xs bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors"
                      title="Export mesh to OBJ format for editing in Blender"
                    >
                      Export to OBJ (Blender)
                    </button>
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="w-full px-3 py-2 text-xs bg-green-500 text-white rounded hover:bg-green-600 transition-colors"
                      title="Import edited mesh from Blender"
                    >
                      Import from OBJ (Blender)
                    </button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".obj"
                      onChange={(e) => {
                        const file = e.target.files?.[0]
                        if (file) {
                          importMeshFromOBJ(file)
                        }
                        // Reset input so same file can be selected again
                        e.target.value = ''
                      }}
                      className="hidden"
                    />
                    {importedMeshGeometry && (
                      <button
                        onClick={() => {
                          setImportedMeshGeometry(null)
                          terrainGeometryRef.current = null
                        }}
                        className="w-full px-3 py-2 text-xs bg-red-500 text-white rounded hover:bg-red-600 transition-colors"
                        title="Clear imported mesh and use generated mesh"
                      >
                        Clear Imported Mesh
                      </button>
                    )}
                  </div>
                  <p className="text-xs text-gray-500 mt-2">
                    {importedMeshGeometry 
                      ? 'Using imported mesh from Blender' 
                      : 'Export/import mesh for editing in Blender'}
                  </p>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

