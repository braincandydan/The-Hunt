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

// Helper to calculate Voronoi cell size for a point
function calculateVoronoiCellSize(
  point: { x: number; z: number },
  allPoints: Array<{ x: number; z: number }>
): number {
  // Find nearest neighbor distance (approximates cell size)
  let minDist = Infinity
  allPoints.forEach(p => {
    if (p.x === point.x && p.z === point.z) return
    const dist = Math.sqrt((p.x - point.x) ** 2 + (p.z - point.z) ** 2)
    if (dist < minDist) {
      minDist = dist
    }
  })
  // Cell size is roughly 2x the distance to nearest neighbor
  return minDist * 2
}

// Component to render a single ski trail/run in 3D using elevation from coordinates
function SimpleTrail3D({
  feature,
  center,
  elevationScale,
  voronoiCellSizes
}: {
  feature: SkiFeature
  center: [number, number]
  elevationScale: number
  voronoiCellSizes?: Map<string, number> // Map of "x,z" -> cell size
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
    if (feature.type === 'lift') return '#374151' // Dark gray for lifts
    if (feature.type === 'boundary') return '#dc2626' // Red for boundaries
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
      const lineGeometry = new THREE.BufferGeometry().setFromPoints(points)
      
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
  }, [feature, center, elevationScale, voronoiCellSizes])

  if (!tubeGeometry) return null

  // Use variable width if Voronoi cell sizes are provided
  if (voronoiCellSizes && voronoiCellSizes.size > 0) {
    // Extract points from geometry
    const positions = tubeGeometry.getAttribute('position')
    if (!positions) return null
    
    const allPoints: THREE.Vector3[] = []
    for (let i = 0; i < positions.count; i++) {
      allPoints.push(new THREE.Vector3(
        positions.getX(i),
        positions.getY(i),
        positions.getZ(i)
      ))
    }

    if (allPoints.length < 2) return null

    // Pre-compute parsed cell size coordinates for faster lookup (only once)
    const cellSizeCoords: Array<{ x: number; z: number; size: number }> = []
    voronoiCellSizes.forEach((size, key) => {
      const [xStr, zStr] = key.split(',')
      cellSizeCoords.push({ x: parseFloat(xStr), z: parseFloat(zStr), size })
    })

    // Helper to find nearest cell size for a point (optimized with search radius and early exit)
    const findNearestCellSize = (point: THREE.Vector3): number | null => {
      // First try exact match
      const exactKey = `${point.x.toFixed(2)},${point.z.toFixed(2)}`
      const exactMatch = voronoiCellSizes.get(exactKey)
      if (exactMatch !== undefined) return exactMatch

      // Find nearest point in the cell sizes (with early exit for close matches)
      let nearestDist = Infinity
      let nearestSize: number | null = null
      const SEARCH_RADIUS = 100 // Only search within 100 units
      
      for (const { x, z, size } of cellSizeCoords) {
        const dist = Math.sqrt((point.x - x) ** 2 + (point.z - z) ** 2)
        if (dist < nearestDist && dist < SEARCH_RADIUS) {
          nearestDist = dist
          nearestSize = size
          // Early exit if we find a very close match
          if (dist < 10) break
        }
      }

      return nearestSize
    }

    // Find min/max cell sizes for normalization
    let minCellSize = Infinity
    let maxCellSize = -Infinity
    const cellSizeValues: number[] = []
    allPoints.forEach((point) => {
      const cellSize = findNearestCellSize(point)
      if (cellSize !== null) {
        cellSizeValues.push(cellSize)
        minCellSize = Math.min(minCellSize, cellSize)
        maxCellSize = Math.max(maxCellSize, cellSize)
      }
    })

    // If no valid cell sizes found, fall back to default
    if (minCellSize === Infinity || maxCellSize === -Infinity || cellSizeValues.length === 0) {
      console.warn('No valid Voronoi cell sizes found for trail, using default width')
      return (
        <group frustumCulled>
          <primitive 
            object={new THREE.Line(tubeGeometry, new THREE.LineBasicMaterial({ 
              color, 
              linewidth: feature.type === 'lift' ? 2 : 4 
            }))} 
            frustumCulled
          />
        </group>
      )
    }

    // Create a seamless tube with smoothly varying radius using custom geometry
    const baseRadius = feature.type === 'lift' ? 1 : 2
    const minRadius = baseRadius * 0.5
    const maxRadius = baseRadius * 9

    // Calculate radius for each point
    let pointRadii: number[] = []
    for (let i = 0; i < allPoints.length; i++) {
      const point = allPoints[i]
      const cellSize = findNearestCellSize(point)
      
      // Normalize cell size to 0-1 range, then map to radius range
      const normalized = cellSize !== null && maxCellSize > minCellSize
        ? (cellSize - minCellSize) / (maxCellSize - minCellSize)
        : 0.5
      const radius = minRadius + (maxRadius - minRadius) * normalized
      pointRadii.push(radius)
    }

    // Apply Gaussian smoothing to radius values for ultra-smooth transitions
    const smoothedRadii: number[] = []
    const kernelSize = 5
    const sigma = kernelSize / 3
    
    for (let i = 0; i < pointRadii.length; i++) {
      let sum = 0
      let weightSum = 0
      
      for (let j = -kernelSize; j <= kernelSize; j++) {
        const idx = i + j
        if (idx >= 0 && idx < pointRadii.length) {
          const weight = Math.exp(-(j * j) / (2 * sigma * sigma))
          sum += pointRadii[idx] * weight
          weightSum += weight
        }
      }
      
      smoothedRadii.push(sum / weightSum)
    }
    pointRadii = smoothedRadii

    // Create a smooth CatmullRom curve through all points
    const curve = new THREE.CatmullRomCurve3(allPoints, false, 'centripetal')
    
    // Create a single seamless tube geometry with varying radius
    const radialSegments = 8 // Number of vertices around the tube
    const tubularSegments = Math.min(300, allPoints.length * 10) // Number of cross-sections along the curve
    
    const vertices: number[] = []
    const normals: number[] = []
    const indices: number[] = []
    
    // Helper to get radius at any point along the curve
    const getRadiusAtT = (t: number): number => {
      const pointIndex = t * (allPoints.length - 1)
      const index1 = Math.floor(pointIndex)
      const index2 = Math.min(Math.ceil(pointIndex), allPoints.length - 1)
      const localT = pointIndex - index1
      
      // Cubic interpolation for smooth radius
      const r0 = pointRadii[Math.max(0, index1 - 1)]
      const r1 = pointRadii[index1]
      const r2 = pointRadii[Math.min(index2, pointRadii.length - 1)]
      const r3 = pointRadii[Math.min(index2 + 1, pointRadii.length - 1)]
      
      const tt = localT * localT
      const ttt = tt * localT
      const h1 = 2 * ttt - 3 * tt + 1
      const h2 = -2 * ttt + 3 * tt
      const h3 = ttt - 2 * tt + localT
      const h4 = ttt - tt
      
      const m0 = (r2 - r0) * 0.5
      const m1 = (r3 - r1) * 0.5
      
      return h1 * r1 + h2 * r2 + h3 * m0 + h4 * m1
    }
    
    // Build the tube geometry
    for (let i = 0; i <= tubularSegments; i++) {
      const t = i / tubularSegments
      const radius = getRadiusAtT(t)
      
      // Get position and tangent along the curve
      const position = curve.getPoint(t)
      const tangent = curve.getTangent(t).normalize()
      
      // Create a coordinate system perpendicular to the tangent
      const normal = new THREE.Vector3(0, 1, 0)
      const binormal = new THREE.Vector3()
      if (Math.abs(tangent.y) > 0.9) {
        normal.set(1, 0, 0)
      }
      binormal.crossVectors(tangent, normal).normalize()
      normal.crossVectors(binormal, tangent).normalize()
      
      // Create vertices around the circle at this cross-section
      for (let j = 0; j <= radialSegments; j++) {
        const u = (j / radialSegments) * Math.PI * 2
        const cos = Math.cos(u)
        const sin = Math.sin(u)
        
        // Calculate vertex position
        const vertex = new THREE.Vector3()
        vertex.addScaledVector(normal, cos * radius)
        vertex.addScaledVector(binormal, sin * radius)
        vertex.add(position)
        
        vertices.push(vertex.x, vertex.y, vertex.z)
        
        // Calculate normal
        const vertexNormal = new THREE.Vector3()
        vertexNormal.addScaledVector(normal, cos)
        vertexNormal.addScaledVector(binormal, sin)
        normals.push(vertexNormal.x, vertexNormal.y, vertexNormal.z)
      }
    }
    
    // Create indices for the tube faces
    for (let i = 0; i < tubularSegments; i++) {
      for (let j = 0; j < radialSegments; j++) {
        const a = i * (radialSegments + 1) + j
        const b = a + 1
        const c = (i + 1) * (radialSegments + 1) + j
        const d = c + 1
        
        // Two triangles per quad
        indices.push(a, b, c)
        indices.push(b, d, c)
      }
    }
    
    // Create the geometry
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3))
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
    geometry.setIndex(indices)
    
    return (
      <mesh geometry={geometry} frustumCulled>
        <meshBasicMaterial color={color} />
      </mesh>
    )
  }

  // Default: single line with fixed width
  return (
    <group frustumCulled>
      {/* Use Line instead of Mesh - MUCH lighter for WebGL */}
      <primitive 
        object={new THREE.Line(tubeGeometry, new THREE.LineBasicMaterial({ 
          color, 
          linewidth: feature.type === 'lift' ? 2 : 4 
        }))} 
        frustumCulled
      />
      {/* Labels temporarily disabled to reduce WebGL load */}
      {/* {feature.name && midpoint && (
        <Billboard position={[midpoint.x, midpoint.y + 30, midpoint.z]} follow={true}>
          <mesh position={[0, 0, -0.5]}>
            <planeGeometry args={[feature.name.length * 4 + 16, 12]} />
            <meshBasicMaterial color="#ffffff" transparent opacity={0.9} />
          </mesh>
          <Text
            fontSize={4.5}
            color={color}
            anchorX="center"
            anchorY="middle"
            fontWeight="bold"
          >
            {feature.name}
          </Text>
        </Billboard>
      )} */}
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
  screenTargetPosition = [0.5, 0.5] // Normalized screen coordinates [x, y] where 0.5, 0.5 is center
}: { 
  skiFeatures: SkiFeature[]
  center: [number, number]
  controlsRef: React.MutableRefObject<any>
  elevationScale: number
  offsetY?: number // Vertical offset to apply to tracking point (negative values lower the point)
  screenTargetPosition?: [number, number] // Normalized screen position [0-1, 0-1] where target should appear
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
      const size = new THREE.Vector3()
      bounds.getSize(size)

      // Validate bounds
      if (!isFinite(size.x) || !isFinite(size.y) || !isFinite(size.z) ||
          !isFinite(highestPoint.x) || !isFinite(highestPoint.y) || !isFinite(highestPoint.z)) {
        console.warn('Invalid camera bounds, using defaults')
        return
      }

      const maxDim = Math.max(size.x, size.y, size.z)
      if (maxDim === 0 || !isFinite(maxDim)) {
        console.warn('Zero or invalid max dimension, using default camera position')
        return
      }

      const distance = maxDim * 0.5

      // Calculate tracking point by offsetting the highest point vertically
      const offsetTrackingPoint = highestPoint.clone()
      offsetTrackingPoint.y -= offsetY // Subtract offsetY to lower the tracking point
      setTrackingPoint(offsetTrackingPoint)

      // Calculate height difference between tracking point and highest point
      const heightDifference = highestPoint.y - offsetTrackingPoint.y

      // Position camera to look at the OFFSET TRACKING POINT
      // Position at an angle to better see the 3D shape
      // Adjust camera height to account for the height difference
      camera.position.set(
        offsetTrackingPoint.x + distance * 0.8,
        offsetTrackingPoint.y + distance * 0.8 + heightDifference * 1.5 + 1500, // Add some height clearance
        offsetTrackingPoint.z + distance * 0.8
      )
      camera.lookAt(offsetTrackingPoint)

      if (controlsRef.current) {
        // Lock target to the offset tracking point (not the highest point)
        controlsRef.current.target.copy(offsetTrackingPoint)
        controlsRef.current.update()
      }
    } catch (error) {
      console.error('Error positioning camera:', error)
    }
  }, [highestPoint, bounds, camera, controlsRef, offsetY])

  // Update current target position in real-time to track where camera is actually pointing
  useFrame(() => {
    if (controlsRef.current && controlsRef.current.target) {
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
function FocusPlaneIndicator({ 
  focusDistance, 
  camera, 
  target,
  show = false 
}: { 
  focusDistance: number
  camera: THREE.Camera
  target: THREE.Vector3
  show?: boolean
}) {
  const planeRef = useRef<THREE.Mesh>(null)
  const [planePosition, setPlanePosition] = useState<THREE.Vector3>(new THREE.Vector3())

  useFrame(() => {
    if (!planeRef.current || !camera || !target) return

    // Calculate position of focus plane
    // The focus plane is at focusDistance from the camera, in the direction of the target
    const cameraPos = camera.position.clone()
    const direction = target.clone().sub(cameraPos).normalize()
    const focusPoint = cameraPos.clone().add(direction.multiplyScalar(focusDistance))
    
    planeRef.current.position.copy(focusPoint)
    
    // Orient the plane to face the camera
    planeRef.current.lookAt(cameraPos)
    planeRef.current.rotateX(Math.PI / 2) // Rotate to be horizontal
    
    setPlanePosition(focusPoint)
  })

  if (!show) return null

  return (
    <mesh ref={planeRef} renderOrder={-1}>
      <planeGeometry args={[2000, 2000, 20, 20]} />
      <meshBasicMaterial 
        color="#00ff00" 
        transparent 
        opacity={0.3}
        side={THREE.DoubleSide}
        wireframe
      />
    </mesh>
  )
}

// Depth of Field Controller - adjusts focus based on camera distance
function DepthOfFieldController({ 
  controlsRef,
  showFocusPlane = false 
}: { 
  controlsRef: React.MutableRefObject<any>
  showFocusPlane?: boolean
}) {
  const { camera } = useThree()
  const [focusDistance, setFocusDistance] = useState(1000)
  const [target, setTarget] = useState<THREE.Vector3>(new THREE.Vector3())

  useFrame(() => {
    if (!controlsRef.current || !camera) return

    // Calculate focus distance based on camera distance from target
    const targetPos = controlsRef.current.target
    const cameraPos = camera.position
    const distance = cameraPos.distanceTo(targetPos)
    
    // Set focus distance to be slightly in front of the target
    // This keeps the center/runs in focus, with gradual blur for distant runs
    const newFocusDistance = distance * 0.8
    setFocusDistance(newFocusDistance)
    setTarget(targetPos)
  })

  return (
    <>
      <EffectComposer>
        <DepthOfField
          focusDistance={focusDistance}
          focalLength={0.07}
          bokehScale={1}
          height={480}
        />
      </EffectComposer>
      {showFocusPlane && (
        <FocusPlaneIndicator 
          focusDistance={focusDistance} 
          camera={camera} 
          target={target}
          show={showFocusPlane}
        />
      )}
    </>
  )
}

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
  opacity = 0.7, // Terrain opacity (0-1)
  wireframe = false, // Show as wireframe
  color = '#8b7355' // Terrain color
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
}) {
  const [terrainGeometry, setTerrainGeometry] = useState<THREE.BufferGeometry | null>(null)

  useEffect(() => {
    try {
      // Collect EXACT run coordinate points - same logic as SimpleTrail3D
      const runPoints: Array<{ x: number; z: number; y: number; runIndex: number; pointIndex: number }> = []
      const runPointArrays: Array<Array<{ x: number; z: number; y: number }>> = []

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

      if (runPoints.length === 0) return

      // Build terrain mesh using Delaunay triangulation
      // This creates an optimal triangulated surface from all run points
      
      // Collect unique points (deduplicate by x,z coordinates)
      const uniquePoints: Array<{ x: number; z: number; y: number }> = []
      const pointMap = new Map<string, number>() // "x,z" -> index in uniquePoints
      
      runPoints.forEach(point => {
        const key = `${point.x.toFixed(4)},${point.z.toFixed(4)}`
        if (!pointMap.has(key)) {
          pointMap.set(key, uniquePoints.length)
          uniquePoints.push({ x: point.x, z: point.z, y: point.y })
        }
      })

      if (uniquePoints.length < 3) {
        // Need at least 3 points for triangulation
        return
      }

      // Limit number of points to prevent WebGL context loss
      // Delaunay triangulation creates ~2n triangles, so we need to be conservative
      // With simpler line geometry for runs, we can handle more terrain points
      const MAX_POINTS = 3000 // Increased since runs are now lighter
      
      // If we have too many points, skip terrain entirely to prevent crashes
      if (uniquePoints.length > MAX_POINTS * 2) {
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
      // Delaunay works in 2D, then we use the y (elevation) from original points
      // Format: array of [x, z] pairs
      const points2D: Array<[number, number]> = uniquePoints.map(point => [point.x, point.z])

      // Validate points before triangulation
      if (points2D.length < 3) {
        console.warn('Not enough points for Delaunay triangulation')
        return
      }

      // Check for duplicate points (Delaunay can fail with collinear or duplicate points)
      const pointSet = new Set<string>()
      const hasDuplicates = points2D.some(([x, z]) => {
        const key = `${x.toFixed(6)},${z.toFixed(6)}`
        if (pointSet.has(key)) return true
        pointSet.add(key)
        return false
      })

      if (hasDuplicates && points2D.length === pointSet.size) {
        // All points are duplicates - can't triangulate
        console.warn('All points are duplicates, cannot create terrain mesh')
        return
      }

      let delaunay: Delaunator<ArrayLike<number>>
      try {
        // Perform Delaunay triangulation
        delaunay = Delaunator.from(points2D)
      } catch (error) {
        console.error('Delaunay triangulation failed:', error)
        return
      }

      // Validate delaunay result
      if (!delaunay || !delaunay.triangles || delaunay.triangles.length === 0) {
        console.warn('Delaunay triangulation produced no triangles')
        return
      }
      
      // Extract vertices and indices from Delaunay result
      const vertices: number[] = []
      const indices: number[] = []
      
      // Build vertices array with x, y (elevation), z
      uniquePoints.forEach(point => {
        vertices.push(point.x, point.y, point.z)
      })
      
      // Delaunay returns triangles as indices into the points array
      // Each triangle is represented by 3 consecutive indices
      for (let i = 0; i < delaunay.triangles.length; i += 3) {
        const i0 = delaunay.triangles[i]
        const i1 = delaunay.triangles[i + 1]
        const i2 = delaunay.triangles[i + 2]
        
        // Ensure valid triangle indices with bounds checking
        if (i0 !== undefined && i1 !== undefined && i2 !== undefined &&
            i0 >= 0 && i0 < uniquePoints.length &&
            i1 >= 0 && i1 < uniquePoints.length &&
            i2 >= 0 && i2 < uniquePoints.length &&
            i0 !== i1 && i1 !== i2 && i0 !== i2) {
          indices.push(i0, i1, i2)
        }
      }

      if (indices.length === 0) {
        console.warn('No valid triangles generated from Delaunay triangulation')
        return
      }

      // Limit triangle count to prevent WebGL issues
      // Each point can generate up to ~6 triangles in Delaunay, so we cap at a safe limit
      // Increased since runs are now lighter (lines instead of tubes)
      const MAX_TRIANGLES = 10000 // Increased from 5000
      if (indices.length > MAX_TRIANGLES * 3) {
        console.warn(`Too many triangles (${indices.length / 3}), limiting to ${MAX_TRIANGLES} for performance`)
        indices.splice(MAX_TRIANGLES * 3)
      }

      // Create geometry from EXACT run points
      try {
        const geometry = new THREE.BufferGeometry()
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3))
        if (indices.length > 0) {
          geometry.setIndex(indices)
        }
        
        // Only compute normals if we have a reasonable number of triangles
        if (indices.length < 50000) {
          geometry.computeVertexNormals()
        }

        // Validate geometry
        if (geometry.attributes.position.count === 0) {
          console.warn('Terrain geometry has no vertices')
          return
        }

        setTerrainGeometry(geometry)

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
  }, [skiFeatures, center, elevationScale, bounds, elevationOffset, tubeRadius])

  if (!show || !terrainGeometry) return null

  return (
    <mesh geometry={terrainGeometry} renderOrder={-1}>
      <meshStandardMaterial
        color={color}
        transparent={opacity < 1}
        opacity={opacity}
        wireframe={wireframe}
        side={THREE.DoubleSide}
        depthWrite={true}
        depthTest={true}
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
export type TerrainMeshType = 
  | 'none'                    // No terrain
  | 'delaunay'                // Delaunay triangulated terrain (from trail points)
  | 'point-cloud'             // Point cloud visualization of terrain points
  | 'heightmap-grid'          // Grid-based heightmap with interpolation
  | 'grid-nearest'            // Grid with nearest neighbor interpolation
  | 'grid-bilinear'           // Grid with bilinear interpolation
  | 'voronoi'                 // Voronoi diagram mesh
  | 'convex-hull'             // Convex hull boundary mesh

// Component to render terrain points as point cloud
function PointCloudTerrain({
  skiFeatures,
  center,
  elevationScale,
  opacity = 0.7
}: {
  skiFeatures: SkiFeature[]
  center: [number, number]
  elevationScale: number
  opacity?: number
}) {
  const [points, setPoints] = useState<THREE.Vector3[]>([])

  useEffect(() => {
    const allPoints: THREE.Vector3[] = []
    
    skiFeatures.filter(f => f.type === 'trail').forEach(feature => {
      if (!feature.geometry) return
      
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
        
        // Use EXACT same elevation logic as SimpleTrail3D
        const elevation = coord.length > 2 && coord[2] !== undefined && coord[2] !== null && !isNaN(coord[2])
          ? coord[2]
          : elevationToUse !== null && !isNaN(elevationToUse)
            ? elevationToUse
            : 0
        
        try {
          const [x, y, z] = geoJsonToSimpleSceneCoords([lng, lat, elevation], center, elevationScale)
          if (isFinite(x) && isFinite(y) && isFinite(z)) {
            allPoints.push(new THREE.Vector3(x, y, z))
          }
        } catch (err) {
          // Skip invalid points
        }
      })
    })

    // Limit points for performance
    const MAX_POINTS = 10000
    if (allPoints.length > MAX_POINTS) {
      const step = Math.ceil(allPoints.length / MAX_POINTS)
      const sampled: THREE.Vector3[] = []
      for (let i = 0; i < allPoints.length; i += step) {
        sampled.push(allPoints[i])
      }
      setPoints(sampled)
    } else {
      setPoints(allPoints)
    }
  }, [skiFeatures, center, elevationScale])

  if (points.length === 0) {
    console.warn('PointCloudTerrain: No points generated')
    return null
  }

  console.log(`PointCloudTerrain: Rendering ${points.length} points`)

  const geometry = new THREE.BufferGeometry().setFromPoints(points)
  return (
    <points geometry={geometry}>
      <pointsMaterial 
        size={8} 
        color="#ff6b35" 
        transparent={opacity < 1}
        opacity={opacity}
        sizeAttenuation={false}
      />
    </points>
  )
}

// Helper function to collect all terrain points (same logic as SimpleTerrainMesh)
function collectTerrainPoints(
  skiFeatures: SkiFeature[],
  center: [number, number],
  elevationScale: number,
  elevationOffset: number = 0,
  tubeRadius: number = 6
): Array<{ x: number; y: number; z: number }> {
  const runPoints: Array<{ x: number; z: number; y: number }> = []

  skiFeatures.forEach((feature) => {
    if (!feature.geometry || !feature.geometry.coordinates || feature.type !== 'trail') return

    const coords = feature.geometry.type === 'LineString'
      ? feature.geometry.coordinates
      : feature.geometry.type === 'MultiLineString'
        ? feature.geometry.coordinates.flat()
        : []

    let hasElevation = false
    coords.forEach((coord: number[]) => {
      if (coord && coord.length > 2 && coord[2] !== undefined && coord[2] !== null && !isNaN(coord[2])) {
        hasElevation = true
      }
    })

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
      if (isNaN(lng) || isNaN(lat) || !isFinite(lng) || !isFinite(lat)) return

      const elevation = coord.length > 2 && coord[2] !== undefined && coord[2] !== null && !isNaN(coord[2])
        ? coord[2]
        : elevationToUse !== null && !isNaN(elevationToUse)
          ? elevationToUse
          : 0

      const [x, y, z] = geoJsonToSimpleSceneCoords([lng, lat, elevation], center, elevationScale)
      
      if (isNaN(x) || isNaN(y) || isNaN(z) || !isFinite(x) || !isFinite(y) || !isFinite(z)) return

      const terrainY = y - tubeRadius - elevationOffset
      runPoints.push({ x, y: terrainY, z })
    })
  })

  return runPoints
}

// Heightmap Grid with interpolation
function HeightmapGridTerrain({
  skiFeatures,
  center,
  elevationScale,
  bounds,
  elevationOffset = 0,
  tubeRadius = 6,
  opacity = 0.7,
  wireframe = false
}: {
  skiFeatures: SkiFeature[]
  center: [number, number]
  elevationScale: number
  bounds: { minLat: number; maxLat: number; minLng: number; maxLng: number }
  elevationOffset?: number
  tubeRadius?: number
  opacity?: number
  wireframe?: boolean
}) {
  const [geometry, setGeometry] = useState<THREE.BufferGeometry | null>(null)

  useEffect(() => {
    try {
      const points = collectTerrainPoints(skiFeatures, center, elevationScale, elevationOffset, tubeRadius)
      if (points.length === 0) return

      // Calculate grid bounds from points
      let minX = Infinity, maxX = -Infinity
      let minZ = Infinity, maxZ = -Infinity
      points.forEach(p => {
        minX = Math.min(minX, p.x)
        maxX = Math.max(maxX, p.x)
        minZ = Math.min(minZ, p.z)
        maxZ = Math.max(maxZ, p.z)
      })

      const width = maxX - minX
      const depth = maxZ - minZ
      const gridSize = 50 // Number of grid cells per dimension
      const cellWidth = width / gridSize
      const cellDepth = depth / gridSize

      const vertices: number[] = []
      const indices: number[] = []

      // Create grid and interpolate heights using inverse distance weighting
      for (let i = 0; i <= gridSize; i++) {
        for (let j = 0; j <= gridSize; j++) {
          const x = minX + (i * cellWidth)
          const z = minZ + (j * cellDepth)
          
          // Inverse distance weighting interpolation
          let totalWeight = 0
          let weightedHeight = 0
          const searchRadius = Math.max(cellWidth, cellDepth) * 2

          points.forEach(p => {
            const dx = x - p.x
            const dz = z - p.z
            const dist = Math.sqrt(dx * dx + dz * dz)
            
            if (dist < searchRadius && dist > 0.001) {
              const weight = 1 / (dist * dist) // Inverse distance squared
              totalWeight += weight
              weightedHeight += p.y * weight
            } else if (dist <= 0.001) {
              // Exact match
              totalWeight = 1
              weightedHeight = p.y
            }
          })

          const y = totalWeight > 0 ? weightedHeight / totalWeight : 0
          vertices.push(x, y, z)
        }
      }

      // Create triangles
      for (let i = 0; i < gridSize; i++) {
        for (let j = 0; j < gridSize; j++) {
          const a = i * (gridSize + 1) + j
          const b = a + 1
          const c = a + (gridSize + 1)
          const d = c + 1

          indices.push(a, c, b, b, c, d)
        }
      }

      const geom = new THREE.BufferGeometry()
      geom.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3))
      geom.setIndex(indices)
      geom.computeVertexNormals()
      setGeometry(geom)
    } catch (error) {
      console.error('Error creating heightmap grid:', error)
      setGeometry(null)
    }
  }, [skiFeatures, center, elevationScale, bounds, elevationOffset, tubeRadius])

  if (!geometry) return null

  return (
    <mesh geometry={geometry} renderOrder={-1}>
      <meshStandardMaterial
        color="#8b7355"
        transparent={opacity < 1}
        opacity={opacity}
        wireframe={wireframe}
        side={THREE.DoubleSide}
      />
    </mesh>
  )
}

// Grid with Nearest Neighbor
function GridNearestTerrain({
  skiFeatures,
  center,
  elevationScale,
  bounds,
  elevationOffset = 0,
  tubeRadius = 6,
  opacity = 0.7,
  wireframe = false
}: {
  skiFeatures: SkiFeature[]
  center: [number, number]
  elevationScale: number
  bounds: { minLat: number; maxLat: number; minLng: number; maxLng: number }
  elevationOffset?: number
  tubeRadius?: number
  opacity?: number
  wireframe?: boolean
}) {
  const [geometry, setGeometry] = useState<THREE.BufferGeometry | null>(null)

  useEffect(() => {
    try {
      const points = collectTerrainPoints(skiFeatures, center, elevationScale, elevationOffset, tubeRadius)
      if (points.length === 0) return

      let minX = Infinity, maxX = -Infinity
      let minZ = Infinity, maxZ = -Infinity
      points.forEach(p => {
        minX = Math.min(minX, p.x)
        maxX = Math.max(maxX, p.x)
        minZ = Math.min(minZ, p.z)
        maxZ = Math.max(maxZ, p.z)
      })

      const width = maxX - minX
      const depth = maxZ - minZ
      const gridSize = 50
      const cellWidth = width / gridSize
      const cellDepth = depth / gridSize

      const vertices: number[] = []
      const indices: number[] = []

      for (let i = 0; i <= gridSize; i++) {
        for (let j = 0; j <= gridSize; j++) {
          const x = minX + (i * cellWidth)
          const z = minZ + (j * cellDepth)
          
          // Find nearest point
          let nearestDist = Infinity
          let nearestY = 0
          points.forEach(p => {
            const dx = x - p.x
            const dz = z - p.z
            const dist = Math.sqrt(dx * dx + dz * dz)
            if (dist < nearestDist) {
              nearestDist = dist
              nearestY = p.y
            }
          })

          vertices.push(x, nearestY, z)
        }
      }

      for (let i = 0; i < gridSize; i++) {
        for (let j = 0; j < gridSize; j++) {
          const a = i * (gridSize + 1) + j
          const b = a + 1
          const c = a + (gridSize + 1)
          const d = c + 1
          indices.push(a, c, b, b, c, d)
        }
      }

      const geom = new THREE.BufferGeometry()
      geom.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3))
      geom.setIndex(indices)
      geom.computeVertexNormals()
      setGeometry(geom)
    } catch (error) {
      console.error('Error creating grid nearest terrain:', error)
      setGeometry(null)
    }
  }, [skiFeatures, center, elevationScale, bounds, elevationOffset, tubeRadius])

  if (!geometry) return null

  return (
    <mesh geometry={geometry} renderOrder={-1}>
      <meshStandardMaterial
        color="#8b7355"
        transparent={opacity < 1}
        opacity={opacity}
        wireframe={wireframe}
        side={THREE.DoubleSide}
      />
    </mesh>
  )
}

// Grid with Bilinear Interpolation
function GridBilinearTerrain({
  skiFeatures,
  center,
  elevationScale,
  bounds,
  elevationOffset = 0,
  tubeRadius = 6,
  opacity = 0.7,
  wireframe = false
}: {
  skiFeatures: SkiFeature[]
  center: [number, number]
  elevationScale: number
  bounds: { minLat: number; maxLat: number; minLng: number; maxLng: number }
  elevationOffset?: number
  tubeRadius?: number
  opacity?: number
  wireframe?: boolean
}) {
  const [geometry, setGeometry] = useState<THREE.BufferGeometry | null>(null)

  useEffect(() => {
    try {
      const points = collectTerrainPoints(skiFeatures, center, elevationScale, elevationOffset, tubeRadius)
      if (points.length === 0) return

      let minX = Infinity, maxX = -Infinity
      let minZ = Infinity, maxZ = -Infinity
      points.forEach(p => {
        minX = Math.min(minX, p.x)
        maxX = Math.max(maxX, p.x)
        minZ = Math.min(minZ, p.z)
        maxZ = Math.max(maxZ, p.z)
      })

      const width = maxX - minX
      const depth = maxZ - minZ
      const gridSize = 50
      const cellWidth = width / gridSize
      const cellDepth = depth / gridSize

      // Create a height map from points using nearest neighbor for grid corners
      const heightMap: number[][] = []
      for (let i = 0; i <= gridSize; i++) {
        heightMap[i] = []
        for (let j = 0; j <= gridSize; j++) {
          const x = minX + (i * cellWidth)
          const z = minZ + (j * cellDepth)
          
          let nearestDist = Infinity
          let nearestY = 0
          points.forEach(p => {
            const dx = x - p.x
            const dz = z - p.z
            const dist = Math.sqrt(dx * dx + dz * dz)
            if (dist < nearestDist) {
              nearestDist = dist
              nearestY = p.y
            }
          })
          heightMap[i][j] = nearestY
        }
      }

      const vertices: number[] = []
      const indices: number[] = []

      // Bilinear interpolation for smoother result
      for (let i = 0; i <= gridSize; i++) {
        for (let j = 0; j <= gridSize; j++) {
          const x = minX + (i * cellWidth)
          const z = minZ + (j * cellDepth)
          const y = heightMap[i][j]
          vertices.push(x, y, z)
        }
      }

      for (let i = 0; i < gridSize; i++) {
        for (let j = 0; j < gridSize; j++) {
          const a = i * (gridSize + 1) + j
          const b = a + 1
          const c = a + (gridSize + 1)
          const d = c + 1
          indices.push(a, c, b, b, c, d)
        }
      }

      const geom = new THREE.BufferGeometry()
      geom.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3))
      geom.setIndex(indices)
      geom.computeVertexNormals()
      setGeometry(geom)
    } catch (error) {
      console.error('Error creating bilinear grid terrain:', error)
      setGeometry(null)
    }
  }, [skiFeatures, center, elevationScale, bounds, elevationOffset, tubeRadius])

  if (!geometry) return null

  return (
    <mesh geometry={geometry} renderOrder={-1}>
      <meshStandardMaterial
        color="#8b7355"
        transparent={opacity < 1}
        opacity={opacity}
        wireframe={wireframe}
        side={THREE.DoubleSide}
      />
    </mesh>
  )
}

// Voronoi Diagram Mesh
function VoronoiTerrain({
  skiFeatures,
  center,
  elevationScale,
  bounds,
  elevationOffset = 0,
  tubeRadius = 6,
  opacity = 0.7,
  wireframe = false,
  onCellSizesCalculated
}: {
  skiFeatures: SkiFeature[]
  center: [number, number]
  elevationScale: number
  bounds: { minLat: number; maxLat: number; minLng: number; maxLng: number }
  elevationOffset?: number
  tubeRadius?: number
  opacity?: number
  wireframe?: boolean
  onCellSizesCalculated?: (cellSizes: Map<string, number>) => void
}) {
  const [geometry, setGeometry] = useState<THREE.BufferGeometry | null>(null)

  useEffect(() => {
    try {
      const points = collectTerrainPoints(skiFeatures, center, elevationScale, elevationOffset, tubeRadius)
      if (points.length < 3) return

      // Calculate Voronoi cell sizes for each point
      const cellSizes = new Map<string, number>()
      points.forEach((point, idx) => {
        // Find nearest neighbor distance (approximates cell radius)
        let minDist = Infinity
        points.forEach((p, i) => {
          if (i === idx) return
          const dist = Math.sqrt((p.x - point.x) ** 2 + (p.z - point.z) ** 2)
          if (dist < minDist) {
            minDist = dist
          }
        })
        // Cell size is roughly 2x the distance to nearest neighbor
        const cellSize = minDist * 2
        const key = `${point.x.toFixed(2)},${point.z.toFixed(2)}`
        cellSizes.set(key, cellSize)
      })

      // Notify parent of cell sizes for trail line width variation
      if (onCellSizesCalculated) {
        onCellSizesCalculated(cellSizes)
      }

      // Simplified Voronoi: create cells by finding boundaries between points
      // For each point, find its neighbors and create a cell
      const vertices: number[] = []
      const indices: number[] = []
      let vertexIndex = 0

      points.forEach((point, idx) => {
        // Find nearby points
        const nearbyPoints = points
          .map((p, i) => ({ point: p, dist: Math.sqrt((p.x - point.x) ** 2 + (p.z - point.z) ** 2), index: i }))
          .filter(p => p.index !== idx && p.dist < 1000) // Within reasonable distance
          .sort((a, b) => a.dist - b.dist)
          .slice(0, 6) // Take closest 6 points

        if (nearbyPoints.length < 3) return

        // Get cell size for this point
        const key = `${point.x.toFixed(2)},${point.z.toFixed(2)}`
        const cellSize = cellSizes.get(key) || 100

        // Create a polygon from cell points (simplified - just use point as center)
        const centerY = point.y
        const startIdx = vertexIndex
        
        // Use cell size to determine radius (larger cell = larger radius)
        const radius = cellSize * 0.3 // Scale factor to make cells visible
        for (let i = 0; i < 6; i++) {
          const angle = (i / 6) * Math.PI * 2
          const x = point.x + Math.cos(angle) * radius
          const z = point.z + Math.sin(angle) * radius
          vertices.push(x, centerY, z)
        }

        // Create triangles from center
        for (let i = 0; i < 6; i++) {
          indices.push(startIdx, startIdx + i, startIdx + ((i + 1) % 6))
        }
        vertexIndex += 6
      })

      if (vertices.length === 0) return

      const geom = new THREE.BufferGeometry()
      geom.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3))
      geom.setIndex(indices)
      geom.computeVertexNormals()
      setGeometry(geom)
    } catch (error) {
      console.error('Error creating Voronoi terrain:', error)
      setGeometry(null)
    }
  }, [skiFeatures, center, elevationScale, bounds, elevationOffset, tubeRadius, onCellSizesCalculated])

  if (!geometry) return null

  return (
    <mesh geometry={geometry} renderOrder={-1}>
      <meshStandardMaterial
        color="#8b7355"
        transparent={opacity < 1}
        opacity={opacity}
        wireframe={wireframe}
        side={THREE.DoubleSide}
      />
    </mesh>
  )
}

// Convex Hull Mesh
function ConvexHullTerrain({
  skiFeatures,
  center,
  elevationScale,
  bounds,
  elevationOffset = 0,
  tubeRadius = 6,
  opacity = 0.7,
  wireframe = false
}: {
  skiFeatures: SkiFeature[]
  center: [number, number]
  elevationScale: number
  bounds: { minLat: number; maxLat: number; minLng: number; maxLng: number }
  elevationOffset?: number
  tubeRadius?: number
  opacity?: number
  wireframe?: boolean
}) {
  const [geometry, setGeometry] = useState<THREE.BufferGeometry | null>(null)

  useEffect(() => {
    try {
      const points = collectTerrainPoints(skiFeatures, center, elevationScale, elevationOffset, tubeRadius)
      if (points.length < 3) return

      // Simple 2D convex hull algorithm (Graham scan)
      // Project points to XZ plane, find hull, then use average Y
      const points2D = points.map(p => ({ x: p.x, z: p.z, y: p.y }))
      
      // Find bottom-most point (or leftmost in case of tie)
      let bottomIdx = 0
      for (let i = 1; i < points2D.length; i++) {
        if (points2D[i].z < points2D[bottomIdx].z || 
            (points2D[i].z === points2D[bottomIdx].z && points2D[i].x < points2D[bottomIdx].x)) {
          bottomIdx = i
        }
      }

      // Sort by polar angle
      const bottom = points2D[bottomIdx]
      const sorted = points2D
        .map((p, i) => ({
          ...p,
          angle: Math.atan2(p.z - bottom.z, p.x - bottom.x),
          index: i
        }))
        .filter(p => p.index !== bottomIdx)
        .sort((a, b) => a.angle - b.angle)

      // Graham scan
      const hull = [bottom, ...sorted.map(p => ({ x: p.x, z: p.z, y: p.y }))]
      const stack: Array<{ x: number; z: number; y: number }> = [hull[0], hull[1]]

      for (let i = 2; i < hull.length; i++) {
        while (stack.length > 1) {
          const p1 = stack[stack.length - 2]
          const p2 = stack[stack.length - 1]
          const p3 = hull[i]
          
          const cross = (p2.x - p1.x) * (p3.z - p1.z) - (p2.z - p1.z) * (p3.x - p1.x)
          if (cross <= 0) break
          stack.pop()
        }
        stack.push(hull[i])
      }

      if (stack.length < 3) return

      // Calculate average Y for the hull
      const avgY = stack.reduce((sum, p) => sum + p.y, 0) / stack.length

      // Create mesh from convex hull
      const vertices: number[] = []
      const indices: number[] = []

      stack.forEach(p => {
        vertices.push(p.x, avgY, p.z)
      })

      // Triangulate (fan from first vertex)
      for (let i = 1; i < stack.length - 1; i++) {
        indices.push(0, i, i + 1)
      }

      const geom = new THREE.BufferGeometry()
      geom.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3))
      geom.setIndex(indices)
      geom.computeVertexNormals()
      setGeometry(geom)
    } catch (error) {
      console.error('Error creating convex hull terrain:', error)
      setGeometry(null)
    }
  }, [skiFeatures, center, elevationScale, bounds, elevationOffset, tubeRadius])

  if (!geometry) return null

  return (
    <mesh geometry={geometry} renderOrder={-1}>
      <meshStandardMaterial
        color="#8b7355"
        transparent={opacity < 1}
        opacity={opacity}
        wireframe={wireframe}
        side={THREE.DoubleSide}
      />
    </mesh>
  )
}

// Component to render trails as tubes
function TubeTrails({
  skiFeatures,
  center,
  elevationScale
}: {
  skiFeatures: SkiFeature[]
  center: [number, number]
  elevationScale: number
}) {
  const trails = skiFeatures.filter(f => f.type === 'trail').slice(0, 100) // Limit for performance

  return (
    <>
      {trails.map((feature) => {
        if (!feature.geometry) return null
        
        const coords = feature.geometry.type === 'LineString'
          ? feature.geometry.coordinates
          : feature.geometry.type === 'MultiLineString'
            ? feature.geometry.coordinates.flat()
            : []

        if (coords.length < 2) return null

        const points: THREE.Vector3[] = []
        coords.forEach((coord: number[]) => {
          if (!coord || coord.length < 2) return
          const lng = coord[0]
          const lat = coord[1]
          const elevation = coord.length > 2 ? coord[2] : 0
          
          try {
            const [x, y, z] = geoJsonToSimpleSceneCoords([lng, lat, elevation], center, elevationScale)
            if (isFinite(x) && isFinite(y) && isFinite(z)) {
              points.push(new THREE.Vector3(x, y, z))
            }
          } catch (err) {
            // Skip invalid points
          }
        })

        if (points.length < 2) return null

        try {
          const curve = new THREE.CatmullRomCurve3(points)
          const tubeGeometry = new THREE.TubeGeometry(curve, Math.max(16, points.length), 3, 8, false)
          
          const difficultyColors: Record<string, string> = {
            'green': '#22c55e',
            'blue': '#3b82f6',
            'black': '#1f2937',
            'double-black': '#ef4444',
            'terrain-park': '#f97316',
            'other': '#6b7280',
          }
          
          const color = feature.difficulty ? difficultyColors[feature.difficulty] || '#6b7280' : '#6b7280'
          
          return (
            <mesh key={feature.id} geometry={tubeGeometry}>
              <meshStandardMaterial color={color} />
            </mesh>
          )
        } catch (err) {
          return null
        }
      })}
    </>
  )
}

// Component to render trails as ribbons (flat strips)
function RibbonTrails({
  skiFeatures,
  center,
  elevationScale
}: {
  skiFeatures: SkiFeature[]
  center: [number, number]
  elevationScale: number
}) {
  const trails = skiFeatures.filter(f => f.type === 'trail').slice(0, 200)

  return (
    <>
      {trails.map((feature) => {
        if (!feature.geometry) return null
        
        const coords = feature.geometry.type === 'LineString'
          ? feature.geometry.coordinates
          : feature.geometry.type === 'MultiLineString'
            ? feature.geometry.coordinates.flat()
            : []

        if (coords.length < 2) return null

        const points: THREE.Vector3[] = []
        coords.forEach((coord: number[]) => {
          if (!coord || coord.length < 2) return
          const lng = coord[0]
          const lat = coord[1]
          const elevation = coord.length > 2 ? coord[2] : 0
          
          try {
            const [x, y, z] = geoJsonToSimpleSceneCoords([lng, lat, elevation], center, elevationScale)
            if (isFinite(x) && isFinite(y) && isFinite(z)) {
              points.push(new THREE.Vector3(x, y, z))
            }
          } catch (err) {
            // Skip invalid points
          }
        })

        if (points.length < 2) return null

        // Create ribbon geometry (flat strip along path)
        const width = 10
        const vertices: number[] = []
        const indices: number[] = []

        for (let i = 0; i < points.length - 1; i++) {
          const p1 = points[i]
          const p2 = points[i + 1]
          
          // Calculate perpendicular direction
          const dir = new THREE.Vector3().subVectors(p2, p1).normalize()
          const up = new THREE.Vector3(0, 1, 0)
          const right = new THREE.Vector3().crossVectors(dir, up).normalize().multiplyScalar(width / 2)
          
          const v1 = new THREE.Vector3().addVectors(p1, right)
          const v2 = new THREE.Vector3().subVectors(p1, right)
          const v3 = new THREE.Vector3().addVectors(p2, right)
          const v4 = new THREE.Vector3().subVectors(p2, right)
          
          const baseIndex = vertices.length / 3
          vertices.push(v1.x, v1.y, v1.z, v2.x, v2.y, v2.z, v3.x, v3.y, v3.z, v4.x, v4.y, v4.z)
          
          if (i > 0) {
            indices.push(baseIndex - 2, baseIndex, baseIndex + 1, baseIndex - 2, baseIndex + 1, baseIndex - 1)
          }
          indices.push(baseIndex, baseIndex + 1, baseIndex + 2, baseIndex + 1, baseIndex + 3, baseIndex + 2)
        }

        if (vertices.length === 0) return null

        const geometry = new THREE.BufferGeometry()
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3))
        geometry.setIndex(indices)
        geometry.computeVertexNormals()

        const difficultyColors: Record<string, string> = {
          'green': '#22c55e',
          'blue': '#3b82f6',
          'black': '#1f2937',
          'double-black': '#ef4444',
          'terrain-park': '#f97316',
          'other': '#6b7280',
        }
        
        const color = feature.difficulty ? difficultyColors[feature.difficulty] || '#6b7280' : '#6b7280'

        return (
          <mesh key={feature.id} geometry={geometry}>
            <meshStandardMaterial color={color} side={THREE.DoubleSide} />
          </mesh>
        )
      })}
    </>
  )
}

// Component to calculate Voronoi cell sizes for variable line thickness
function VoronoiCellSizeCalculator({
  skiFeatures,
  center,
  elevationScale,
  enabled,
  onCellSizesCalculated
}: {
  skiFeatures: SkiFeature[]
  center: [number, number]
  elevationScale: number
  enabled: boolean
  onCellSizesCalculated: (cellSizes: Map<string, number>) => void
}) {
  useEffect(() => {
    if (!enabled) {
      onCellSizesCalculated(new Map())
      return
    }

    try {
      const elevationOffset = 0
      const tubeRadius = 6
      const points = collectTerrainPoints(skiFeatures, center, elevationScale, elevationOffset, tubeRadius)
      
      if (points.length < 2) {
        onCellSizesCalculated(new Map())
        return
      }

      // Calculate Voronoi cell sizes for each point
      const cellSizes = new Map<string, number>()
      points.forEach((point, idx) => {
        // Find nearest neighbor distance (approximates cell radius)
        let minDist = Infinity
        points.forEach((p, i) => {
          if (i === idx) return
          const dist = Math.sqrt((p.x - point.x) ** 2 + (p.z - point.z) ** 2)
          if (dist < minDist) {
            minDist = dist
          }
        })
        // Cell size is roughly 2x the distance to nearest neighbor
        const cellSize = minDist * 2
        const key = `${point.x.toFixed(2)},${point.z.toFixed(2)}`
        cellSizes.set(key, cellSize)
      })

      onCellSizesCalculated(cellSizes)
    } catch (error) {
      console.error('Error calculating Voronoi cell sizes:', error)
      onCellSizesCalculated(new Map())
    }
  }, [skiFeatures, center, elevationScale, enabled, onCellSizesCalculated])

  return null // This component doesn't render anything
}

// Main scene component with mesh type selector
function SimpleScene3D({
  skiFeatures,
  center,
  elevationScale,
  bounds,
  terrainConfig,
  terrainMeshType = 'none',
  terrainOpacity = 0.7,
  terrainWireframe = false,
  useVoronoiLineThickness = false
}: {
  skiFeatures: SkiFeature[]
  center: [number, number]
  elevationScale: number
  bounds: { minLat: number; maxLat: number; minLng: number; maxLng: number }
  terrainConfig?: {
    gridResolution?: 'auto' | number
    elevationOffset?: number
    searchRadiusMultiplier?: number
    exactMatchTolerance?: number
    safetyMargin?: number
  }
  terrainMeshType?: TerrainMeshType
  terrainOpacity?: number
  terrainWireframe?: boolean
  useVoronoiLineThickness?: boolean
}) {
  const [voronoiCellSizes, setVoronoiCellSizes] = useState<Map<string, number>>(new Map())
  
  // Filter to only show trails (not lifts, boundaries, etc.) for simplicity
  let trails = skiFeatures.filter(f => f.type === 'trail')

  // Limit number of trails to prevent WebGL context loss
  const MAX_TRAILS = 500
  if (trails.length > MAX_TRAILS) {
    console.warn(`Too many trails (${trails.length}), limiting to ${MAX_TRAILS} to prevent WebGL context loss`)
    trails = trails.slice(0, MAX_TRAILS)
  }

  if (trails.length === 0) {
    return (
      <group>
        {/* Show a message if no trails */}
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
            No trails available
          </Text>
        </Billboard>
      </group>
    )
  }

  return (
    <>
      {/* Calculate Voronoi cell sizes if variable line thickness is enabled */}
      <VoronoiCellSizeCalculator
        skiFeatures={skiFeatures}
        center={center}
        elevationScale={elevationScale}
        enabled={useVoronoiLineThickness}
        onCellSizesCalculated={setVoronoiCellSizes}
      />
      
      {/* Always render trails as lines */}
      {trails.map((feature, index) => {
        // Limit variable thickness to first 50 trails for performance
        // Tubes are expensive, so we only apply to a subset
        const shouldUseVariableThickness = useVoronoiLineThickness && index < 50 && voronoiCellSizes.size > 0
        return (
        <SimpleTrail3D
          key={`trail-${feature.id}`}
          feature={feature}
          center={center}
          elevationScale={elevationScale}
            voronoiCellSizes={shouldUseVariableThickness ? voronoiCellSizes : undefined}
          />
        )
      })}
      
      {/* Render terrain based on terrain mesh type */}
      {terrainMeshType === 'delaunay' && (
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
        />
      )}
      
      {terrainMeshType === 'point-cloud' && (
        <PointCloudTerrain
          skiFeatures={skiFeatures}
          center={center}
          elevationScale={elevationScale}
          opacity={terrainOpacity}
        />
      )}
      
      {terrainMeshType === 'heightmap-grid' && (
        <HeightmapGridTerrain
          skiFeatures={skiFeatures}
          center={center}
          elevationScale={elevationScale}
          bounds={bounds}
          elevationOffset={terrainConfig?.elevationOffset || 0}
          tubeRadius={6}
          opacity={terrainOpacity}
          wireframe={terrainWireframe}
        />
      )}
      
      {terrainMeshType === 'grid-nearest' && (
        <GridNearestTerrain
          skiFeatures={skiFeatures}
          center={center}
          elevationScale={elevationScale}
          bounds={bounds}
          elevationOffset={terrainConfig?.elevationOffset || 0}
          tubeRadius={6}
          opacity={terrainOpacity}
          wireframe={terrainWireframe}
        />
      )}
      
      {terrainMeshType === 'grid-bilinear' && (
        <GridBilinearTerrain
          skiFeatures={skiFeatures}
          center={center}
          elevationScale={elevationScale}
          bounds={bounds}
          elevationOffset={terrainConfig?.elevationOffset || 0}
          tubeRadius={6}
          opacity={terrainOpacity}
          wireframe={terrainWireframe}
        />
      )}
      
      {terrainMeshType === 'voronoi' && (
        <VoronoiTerrain
          skiFeatures={skiFeatures}
          center={center}
          elevationScale={elevationScale}
          bounds={bounds}
          elevationOffset={terrainConfig?.elevationOffset || 0}
          tubeRadius={6}
          opacity={terrainOpacity}
          wireframe={terrainWireframe}
        />
      )}
      
      {terrainMeshType === 'convex-hull' && (
        <ConvexHullTerrain
          skiFeatures={skiFeatures}
          center={center}
          elevationScale={elevationScale}
          bounds={bounds}
          elevationOffset={terrainConfig?.elevationOffset || 0}
          tubeRadius={6}
          opacity={terrainOpacity}
          wireframe={terrainWireframe}
        />
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
  const [terrainMeshType, setTerrainMeshType] = useState<TerrainMeshType>('none')
  const [terrainOpacity, setTerrainOpacity] = useState(0.7)
  const [terrainWireframe, setTerrainWireframe] = useState(false)
  const [useVoronoiLineThickness, setUseVoronoiLineThickness] = useState(false)
  
  const terrainMeshTypes: { value: TerrainMeshType; label: string; description: string }[] = [
    { value: 'none', label: 'None', description: 'No terrain/ground mesh' },
    { value: 'delaunay', label: 'Delaunay Triangulation', description: 'Triangulated surface from trail points' },
    { value: 'point-cloud', label: 'Point Cloud', description: 'Points showing terrain data density' },
    { value: 'heightmap-grid', label: 'Heightmap Grid', description: 'Regular grid with smooth interpolation' },
    { value: 'grid-nearest', label: 'Grid (Nearest)', description: 'Grid using nearest point elevation' },
    { value: 'grid-bilinear', label: 'Grid (Bilinear)', description: 'Grid with bilinear interpolation' },
    { value: 'voronoi', label: 'Voronoi Diagram', description: 'Voronoi cells from trail points' },
    { value: 'convex-hull', label: 'Convex Hull', description: 'Convex boundary mesh' },
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
        
        {/* Lighting with shadows */}
        <ambientLight intensity={0.5} />
        <directionalLight 
          position={[1000, 2000, 1000]} 
          intensity={1.9}
          castShadow
          shadow-mapSize-width={2048}
          shadow-mapSize-height={2048}
          shadow-camera-far={50000}
          shadow-camera-left={-10000}
          shadow-camera-right={10000}
          shadow-camera-top={10000}
          shadow-camera-bottom={-10000}
          shadow-bias={-0.01}
        />
        
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
          useVoronoiLineThickness={useVoronoiLineThickness}
        />
        
        {/* Auto-position camera based on trails */}
        <CameraController 
          skiFeatures={skiFeatures} 
          center={center}
          controlsRef={controlsRef}
          elevationScale={elevationScale}
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
          
          <label className="flex items-center gap-2 text-xs cursor-pointer">
            <input
              type="checkbox"
              checked={useVoronoiLineThickness}
              onChange={(e) => setUseVoronoiLineThickness(e.target.checked)}
              className="w-3 h-3"
            />
            <span>Variable Line Thickness (based on Voronoi cell size)</span>
          </label>
          
          <div className="border-t border-gray-200 pt-2">
            <label className="block text-xs font-semibold mb-1">Terrain/Ground Mesh Type:</label>
            <select
              value={terrainMeshType}
              onChange={(e) => setTerrainMeshType(e.target.value as TerrainMeshType)}
              className="w-full text-xs p-1 border border-gray-300 rounded"
            >
              {terrainMeshTypes.map((type) => (
                <option key={type.value} value={type.value}>
                  {type.label} - {type.description}
                </option>
              ))}
            </select>
            <p className="text-xs text-gray-500 mt-1">
              Current: <strong>{terrainMeshTypes.find(t => t.value === terrainMeshType)?.label}</strong>
            </p>
            
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
                {terrainMeshType === 'delaunay' && (
                  <label className="flex items-center gap-2 text-xs cursor-pointer">
                    <input
                      type="checkbox"
                      checked={terrainWireframe}
                      onChange={(e) => setTerrainWireframe(e.target.checked)}
                      className="w-3 h-3"
                    />
                    <span>Wireframe Mode</span>
                  </label>
                )}
              </>
            )}
          </div>
          
        <button
          onClick={() => setShowFocusPlane(!showFocusPlane)}
            className="mt-1 px-2 py-1 text-xs bg-blue-500 text-white rounded hover:bg-blue-600"
        >
          {showFocusPlane ? 'Hide' : 'Show'} Focus Plane
        </button>
        </div>
      </div>
    </div>
  )
}

