'use client'

import { useEffect, useRef, useState, useMemo } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls, PerspectiveCamera, Billboard, Text } from '@react-three/drei'
import * as THREE from 'three'
import { Sign, GeoJSONGeometry } from '@/lib/utils/types'
import TerrainMesh from './TerrainMesh'
import { 
  loadSceneMetadata, 
  latLngToSceneCoords, 
  geoJsonToSceneCoords,
  type SceneMetadata 
} from '@/lib/utils/terrain-coordinates'
import { loadGeoJSONFile, type GeoJSONFeatureCollection } from '@/lib/utils/load-geojson'

// GPS Location Marker Component - uses 3D elements for smooth camera movement
function GPSMarker3D({
  lat,
  lng,
  sceneMetadata,
  terrainMesh
}: {
  lat: number
  lng: number
  sceneMetadata: SceneMetadata
  terrainMesh: THREE.Mesh | null
}) {
  const [elevation, setElevation] = useState<number>(0)
  const markerRef = useRef<THREE.Mesh>(null)

  // Use raycasting to find terrain elevation
  useEffect(() => {
    if (!terrainMesh) {
      // Fallback: use default elevation
      setElevation(50)
      return
    }

    // Convert GPS position to scene coordinates
    const [x, y, z] = latLngToSceneCoords(lat, lng, 0, sceneMetadata)
    
    // Create raycaster pointing down from above
    const raycaster = new THREE.Raycaster()
    const rayOrigin = new THREE.Vector3(x, y + 1000, z) // Start 1000m above
    const rayDirection = new THREE.Vector3(0, -1, 0) // Point downward
    raycaster.set(rayOrigin, rayDirection)

    // Intersect with terrain mesh
    const intersects = raycaster.intersectObject(terrainMesh, true)
    
    if (intersects.length > 0) {
      const hitPoint = intersects[0].point
      setElevation(hitPoint.y + 5) // 5m above terrain
    } else {
      // Fallback: use default elevation
      setElevation(50)
    }
  }, [lat, lng, terrainMesh, sceneMetadata])

  // Convert to scene coordinates
  const [x, y, z] = latLngToSceneCoords(lat, lng, elevation, sceneMetadata)

  return (
    <group position={[x, y, z]} frustumCulled>
      <mesh ref={markerRef} frustumCulled>
        <coneGeometry args={[5, 15, 8]} />
        <meshStandardMaterial 
          color="#3b82f6" 
          emissive="#3b82f6"
          emissiveIntensity={0.5}
        />
      </mesh>
      {/* Label using Billboard + Text for smooth camera tracking */}
      <Billboard position={[0, 25, 0]} follow={true}>
        <mesh position={[0, 0, -0.5]}>
          <planeGeometry args={[60, 12]} />
          <meshBasicMaterial color="#3b82f6" />
        </mesh>
        <Text
          fontSize={5}
          color="#ffffff"
          anchorX="center"
          anchorY="middle"
          fontWeight="bold"
        >
          You are here
        </Text>
      </Billboard>
    </group>
  )
}

interface MapView3DProps {
  resortSlug: string
  signs: Sign[]
  discoveredSignIds: Set<string>
  skiFeatures?: Array<{
    id: string
    name: string
    type: 'trail' | 'lift' | 'boundary' | 'area' | 'road'
    difficulty?: string
    geometry: GeoJSONGeometry
    status?: string
    metadata?: Record<string, unknown>
  }>
  resortName?: string
  onSpeedUpdate?: (speedData: { current: number | null; top: number; average: number }) => void
  // Path to qgisthreejs export (HTML file or scene data)
  sceneUrl?: string // e.g., '/3d-map/index.html' or '/3d-map/scene.json'
  // Center coordinates for the 3D scene
  center?: [number, number] // [lat, lng]
  // Elevation scale factor (to make terrain more visible)
  elevationScale?: number
  // Optional: Paths to additional GeoJSON files from QGIS exports
  additionalGeoJSONPaths?: string[] // e.g., ['/3d-map/geojson/tree-line.json', '/3d-map/geojson/runs.json']
  // Proximity zone visualization
  showProximityZones?: boolean
  proximityThreshold?: number // meters
}

// Component to render markers in 3D space - uses 3D elements for smooth camera movement
function Marker3D({ 
  position, 
  isFound, 
  name, 
  description, 
  resortSlug, 
  signId 
}: { 
  position: [number, number, number]
  isFound: boolean
  name: string
  description?: string
  resortSlug: string
  signId: string
}) {
  const [hovered, setHovered] = useState(false)
  const meshRef = useRef<THREE.Mesh>(null)
  // position is [x, y, z] where y is elevation (up)
  const baseY = position[1]
  const displayColor = isFound ? '#10b981' : '#6b7280'

  useFrame((state) => {
    if (meshRef.current) {
      // Gentle floating animation
      meshRef.current.position.y = baseY + 10 + Math.sin(state.clock.elapsedTime * 2) * 3
    }
  })

  return (
    <group position={[position[0], position[1], position[2]]} frustumCulled>
      <mesh
        ref={meshRef}
        frustumCulled
        onPointerOver={(e) => {
          e.stopPropagation()
          setHovered(true)
        }}
        onPointerOut={(e) => {
          e.stopPropagation()
          setHovered(false)
        }}
        onClick={(e) => {
          e.stopPropagation()
          window.location.href = `/${resortSlug}/game/sign/${signId}`
        }}
      >
        <sphereGeometry args={[8, 16, 16]} />
        <meshStandardMaterial 
          color={displayColor} 
          emissive={displayColor}
          emissiveIntensity={hovered ? 0.6 : 0.3}
        />
      </mesh>
      {/* Name label using Billboard + Text */}
      <Billboard position={[0, 25, 0]} follow={true}>
        <mesh position={[0, 0, -0.5]}>
          <planeGeometry args={[name.length * 4 + 12, 10]} />
          <meshBasicMaterial color={hovered ? '#ffffff' : '#f8f8f8'} transparent opacity={0.95} />
        </mesh>
        <Text
          fontSize={4}
          color="#374151"
          anchorX="center"
          anchorY="middle"
          fontWeight="bold"
        >
          {name}
        </Text>
      </Billboard>
      {/* Hover description using Billboard + Text */}
      {hovered && description && (
        <Billboard position={[0, 45, 0]} follow={true}>
          <mesh position={[0, 0, -0.5]}>
            <planeGeometry args={[80, 16]} />
            <meshBasicMaterial color="#ffffff" transparent opacity={0.95} />
          </mesh>
          <Text
            fontSize={3.5}
            color="#4b5563"
            anchorX="center"
            anchorY="middle"
            maxWidth={70}
          >
            {description}
          </Text>
        </Billboard>
      )}
    </group>
  )
}

// Component to render ski trails in 3D - uses 3D elements for smooth camera movement
function Trail3D({ 
  geometry, 
  color, 
  name,
  center,
  isLift = false,
  sceneMetadata
}: { 
  geometry: any
  color: string
  name?: string
  center: [number, number]
  isLift?: boolean
  sceneMetadata?: SceneMetadata
}) {
  const points = useRef<THREE.Vector3[]>([])
  const [midpoint, setMidpoint] = useState<THREE.Vector3 | null>(null)

  useEffect(() => {
    // Convert GeoJSON coordinates to 3D points
    const coords = geometry.type === 'LineString' 
      ? geometry.coordinates
      : geometry.coordinates.flat()
    
    if (coords.length === 0) return

    points.current = coords.map((coord: number[]) => {
      // GeoJSON is [lng, lat, elevation?]
      // Use terrain coordinate utilities
      if (sceneMetadata) {
        const [x, y, z] = geoJsonToSceneCoords(coord, sceneMetadata)
        return new THREE.Vector3(x, y, z)
      } else {
        // Fallback: simple conversion (shouldn't happen if metadata is loaded)
        const lng = coord[0]
        const lat = coord[1]
        const elevation = coord.length > 2 ? coord[2] : 0
        const latRad = center[0] * Math.PI / 180
        const x = (lng - center[1]) * 111320 * Math.cos(latRad)
        const z = (lat - center[0]) * 111320
        const y = elevation * 0.1
        return new THREE.Vector3(x, z, y)
      }
    })

    // Calculate midpoint for label
    if (points.current.length > 0) {
      const midIndex = Math.floor(points.current.length / 2)
      setMidpoint(points.current[midIndex])
    }
  }, [geometry, center, sceneMetadata])

  if (points.current.length < 2) return null

  const curve = new THREE.CatmullRomCurve3(points.current)
  const radius = isLift ? 1.5 : 3
  const segments = Math.max(32, points.current.length)
  const tubeGeometry = new THREE.TubeGeometry(curve, segments, radius, 8, false)

  return (
    <group frustumCulled>
      <mesh geometry={tubeGeometry} frustumCulled>
        <meshStandardMaterial 
          color={color} 
          emissive={color}
          emissiveIntensity={0.2}
        />
      </mesh>
      {/* Label at midpoint using Billboard + Text */}
      {name && midpoint && (
        <Billboard position={[midpoint.x, midpoint.y + 25, midpoint.z]} follow={true}>
          <mesh position={[0, 0, -0.5]}>
            <planeGeometry args={[name.length * 4 + 12, 10]} />
            <meshBasicMaterial color="#f8f8f8" transparent opacity={0.9} />
          </mesh>
          <Text
            fontSize={4}
            color={color}
            anchorX="center"
            anchorY="middle"
            fontWeight="bold"
          >
            {name}
          </Text>
        </Billboard>
      )}
    </group>
  )
}

// Component to render polygons (tree areas, boundaries, etc.) in 3D - draped onto terrain
function Polygon3D({
  geometry,
  color,
  sceneMetadata,
  terrainMesh
}: {
  geometry: any
  color: string
  sceneMetadata: SceneMetadata
  terrainMesh: THREE.Mesh | null
}) {
  const meshRef = useRef<THREE.Mesh>(null)
  const [drapedGeometry, setDrapedGeometry] = useState<THREE.BufferGeometry | null>(null)

  useEffect(() => {
    if (!terrainMesh) return

    // Extract coordinates from Polygon or MultiPolygon
    let polygons: number[][][][] = []
    
    if (geometry.type === 'Polygon') {
      polygons = [geometry.coordinates]
    } else if (geometry.type === 'MultiPolygon') {
      polygons = geometry.coordinates
    }

    // Collect all vertices and faces for all polygons
    const allVertices: number[] = []
    const allIndices: number[] = []
    let vertexOffset = 0

    // Raycaster for projecting onto terrain
    const raycaster = new THREE.Raycaster()
    const downDirection = new THREE.Vector3(0, -1, 0)

    polygons.forEach((polygon) => {
      if (polygon.length === 0) return

      // Get the outer ring (first ring)
      const outerRing = polygon[0]
      if (outerRing.length < 3) return

      // Convert coordinates to scene coordinates and project onto terrain
      const projectedPoints: THREE.Vector3[] = []

      outerRing.forEach((coord: number[]) => {
        const [x, y, z] = geoJsonToSceneCoords(coord, sceneMetadata)
        
        // Raycast from high above down to terrain to get actual Y
        const rayOrigin = new THREE.Vector3(x, 5000, z) // Start high above
        raycaster.set(rayOrigin, downDirection)
        
        const intersects = raycaster.intersectObject(terrainMesh, false)
        
        let terrainY = y // Fallback to converted elevation
        if (intersects.length > 0) {
          terrainY = intersects[0].point.y + 5 // Slightly above terrain
        }
        
        projectedPoints.push(new THREE.Vector3(x, terrainY, z))
      })

      // Create a 2D shape for triangulation
      const shape = new THREE.Shape()
      
      // Use first point as reference for 2D projection
      const refPoint = projectedPoints[0]
      shape.moveTo(0, 0)
      
      for (let i = 1; i < projectedPoints.length; i++) {
        const p = projectedPoints[i]
        shape.lineTo(p.x - refPoint.x, p.z - refPoint.z)
      }
      shape.closePath()

      // Triangulate the shape
      const shapeGeom = new THREE.ShapeGeometry(shape)
      const shapePositions = shapeGeom.attributes.position.array
      const shapeIndices = shapeGeom.index ? shapeGeom.index.array : null

      // Map 2D triangulated vertices back to 3D with terrain-projected Y
      const vertexMap = new Map<string, number>() // Map 2D position to original 3D index
      
      // Build a map from 2D coordinates to their 3D projected points
      for (let i = 0; i < projectedPoints.length; i++) {
        const p = projectedPoints[i]
        const key = `${(p.x - refPoint.x).toFixed(2)},${(p.z - refPoint.z).toFixed(2)}`
        vertexMap.set(key, i)
      }

      // Convert shape geometry vertices to 3D terrain-draped vertices
      const localVertices: THREE.Vector3[] = []
      
      for (let i = 0; i < shapePositions.length; i += 3) {
        const sx = shapePositions[i]
        const sy = shapePositions[i + 1]
        // sz is always 0 for ShapeGeometry
        
        // Find the closest original point or interpolate
        const worldX = sx + refPoint.x
        const worldZ = sy + refPoint.z
        
        // Raycast for this vertex position
        const rayOrigin = new THREE.Vector3(worldX, 5000, worldZ)
        raycaster.set(rayOrigin, downDirection)
        
        const intersects = raycaster.intersectObject(terrainMesh, false)
        
        let terrainY = refPoint.y // Fallback
        if (intersects.length > 0) {
          terrainY = intersects[0].point.y + 5 // Slightly above terrain
        }
        
        localVertices.push(new THREE.Vector3(worldX, terrainY, worldZ))
        allVertices.push(worldX, terrainY, worldZ)
      }

      // Add indices with offset
      if (shapeIndices) {
        for (let i = 0; i < shapeIndices.length; i++) {
          allIndices.push(shapeIndices[i] + vertexOffset)
        }
      }
      
      vertexOffset += localVertices.length

      shapeGeom.dispose()
    })

    if (allVertices.length === 0) return

    // Create the final BufferGeometry
    const bufferGeom = new THREE.BufferGeometry()
    bufferGeom.setAttribute('position', new THREE.Float32BufferAttribute(allVertices, 3))
    
    if (allIndices.length > 0) {
      bufferGeom.setIndex(allIndices)
    }
    
    bufferGeom.computeVertexNormals()

    setDrapedGeometry(bufferGeom)

    return () => {
      bufferGeom.dispose()
    }
  }, [geometry, sceneMetadata, terrainMesh])

  if (!drapedGeometry) return null

  return (
    <mesh ref={meshRef} geometry={drapedGeometry} frustumCulled>
      <meshStandardMaterial 
        color={color} 
        transparent
        opacity={0.7}
        side={THREE.DoubleSide}
        depthWrite={false}
      />
    </mesh>
  )
}

// TerrainMesh component is now imported from TerrainMesh.tsx

// Camera controller that positions camera based on terrain
function CameraController({ terrainMesh, controlsRef }: { terrainMesh: THREE.Mesh | null, controlsRef: React.MutableRefObject<any> }) {
  const { camera } = useThree()

  useEffect(() => {
    if (terrainMesh) {
      const geometry = terrainMesh.geometry
      geometry.computeBoundingBox()
      
      if (geometry.boundingBox) {
        const box = geometry.boundingBox
        const center = box.getCenter(new THREE.Vector3())
        const size = new THREE.Vector3()
        box.getSize(size)
        const maxDim = Math.max(size.x, size.y, size.z)
        
        // Position camera to look at the ACTUAL mesh center
        // Camera should be far enough to see the whole mesh
        const distance = maxDim * 2.5
        camera.position.set(
          center.x + distance,
          center.y + distance * 0.6,
          center.z + distance
        )
        camera.lookAt(center)
        
        if (controlsRef.current) {
          controlsRef.current.target.copy(center)
          controlsRef.current.update()
        }
      }
    } else {
      // Fallback: look at origin
      camera.position.set(10000, 5000, 10000)
      camera.lookAt(0, 0, 0)
      if (controlsRef.current) {
        controlsRef.current.target.set(0, 0, 0)
        controlsRef.current.update()
      }
    }
  }, [terrainMesh, camera, controlsRef])

  return null
}

// Component to render a sign marker that projects onto terrain (uses Sign type from Supabase)
// Uses 3D elements (Billboard + Text) instead of HTML overlays for smooth camera movement
function SignMarker3D({
  sign,
  isFound,
  resortSlug,
  sceneMetadata,
  terrainMesh,
}: {
  sign: Sign
  isFound: boolean
  resortSlug: string
  sceneMetadata: SceneMetadata
  terrainMesh: THREE.Mesh
}) {
  const [hovered, setHovered] = useState(false)
  const [elevation, setElevation] = useState<number | null>(null)
  const groupRef = useRef<THREE.Group>(null)
  const meshRef = useRef<THREE.Mesh>(null)

  const lat = parseFloat(sign.lat.toString())
  const lng = parseFloat(sign.lng.toString())

  // Raycast to find terrain elevation
  useEffect(() => {
    const [x, , z] = latLngToSceneCoords(lat, lng, 0, sceneMetadata)
    
    const raycaster = new THREE.Raycaster()
    const rayOrigin = new THREE.Vector3(x, 5000, z)
    const downDirection = new THREE.Vector3(0, -1, 0)
    raycaster.set(rayOrigin, downDirection)
    
    const intersects = raycaster.intersectObject(terrainMesh, false)
    
    if (intersects.length > 0) {
      setElevation(intersects[0].point.y + 15) // 15m above terrain
    } else {
      setElevation(100) // Fallback
    }
  }, [lat, lng, sceneMetadata, terrainMesh])

  // Convert to scene coordinates
  const [x, , z] = latLngToSceneCoords(lat, lng, 0, sceneMetadata)

  // Floating animation for the sign marker
  useFrame((state) => {
    if (meshRef.current && elevation !== null) {
      const orderIdx = sign.order_index ?? 0
      meshRef.current.position.y = Math.sin(state.clock.elapsedTime * 2 + orderIdx) * 3
    }
  })

  // Difficulty colors (matching ski trail standards)
  const difficultyColors: Record<string, string> = {
    'green': '#22c55e',      // Green circle - easiest
    'easy': '#22c55e',
    'blue': '#3b82f6',       // Blue square - intermediate  
    'medium': '#3b82f6',
    'black': '#1f2937',      // Black diamond - advanced
    'hard': '#1f2937',
    'double-black': '#ef4444', // Double black - expert
    'expert': '#ef4444',
  }
  
  const color = sign.difficulty ? (difficultyColors[sign.difficulty] || '#6b7280') : '#6b7280'
  const foundColor = '#10b981' // Green for found signs
  const displayColor = isFound ? foundColor : color

  if (elevation === null) return null

  return (
    <group ref={groupRef} position={[x, elevation, z]} frustumCulled>
      {/* Sign post */}
      <mesh position={[0, -10, 0]} frustumCulled>
        <cylinderGeometry args={[1, 1, 20, 8]} />
        <meshStandardMaterial color="#8B4513" />
      </mesh>
      
      {/* Sign marker - diamond shape */}
      <mesh
        ref={meshRef}
        frustumCulled
        onPointerOver={(e) => {
          e.stopPropagation()
          setHovered(true)
          document.body.style.cursor = 'pointer'
        }}
        onPointerOut={(e) => {
          e.stopPropagation()
          setHovered(false)
          document.body.style.cursor = 'auto'
        }}
        onClick={(e) => {
          e.stopPropagation()
          window.location.href = `/${resortSlug}/game/sign/${sign.id}`
        }}
        rotation={[0, 0, Math.PI / 4]} // Rotate to diamond shape
      >
        <boxGeometry args={[12, 12, 3]} />
        <meshStandardMaterial 
          color={displayColor} 
          emissive={displayColor}
          emissiveIntensity={hovered ? 0.8 : 0.4}
        />
      </mesh>
      
      {/* Found checkmark - using 3D Text */}
      {isFound && (
        <Billboard position={[0, 5, 0]} follow={true}>
          <Text
            fontSize={8}
            color="#ffffff"
            anchorX="center"
            anchorY="middle"
            outlineWidth={0.5}
            outlineColor="#000000"
          >
            ✓
          </Text>
        </Billboard>
      )}
      
      {/* Sign name label - using Billboard + Text (always faces camera, locked to 3D position) */}
      <Billboard position={[0, 30, 0]} follow={true}>
        {/* Background plane for label */}
        <mesh position={[0, 0, -0.5]}>
          <planeGeometry args={[sign.name.length * 5 + 16, 14]} />
          <meshBasicMaterial color={hovered ? '#ffffff' : '#f8f8f8'} transparent opacity={0.95} />
        </mesh>
        <Text
          fontSize={6}
          color={displayColor}
          anchorX="center"
          anchorY="middle"
          fontWeight="bold"
        >
          {sign.name}{isFound ? ' ✓' : ''}
        </Text>
      </Billboard>
      
      {/* Hover info - using Billboard + Text */}
      {hovered && (
        <Billboard position={[0, 55, 0]} follow={true}>
          {/* Background plane for tooltip */}
          <mesh position={[0, 0, -0.5]}>
            <planeGeometry args={[100, 35]} />
            <meshBasicMaterial color="#ffffff" transparent opacity={0.95} />
          </mesh>
          <group>
            {/* Description text */}
            {sign.description && (
              <Text
                position={[0, 8, 0]}
                fontSize={4}
                color="#374151"
                anchorX="center"
                anchorY="middle"
                maxWidth={90}
              >
                {sign.description}
              </Text>
            )}
            {/* Hint or found status */}
            <Text
              position={[0, -2, 0]}
              fontSize={3.5}
              color={isFound ? '#10b981' : '#6b7280'}
              anchorX="center"
              anchorY="middle"
            >
              {isFound ? '✓ Discovered!' : (sign.hint ? `💡 ${sign.hint}` : '')}
            </Text>
            {/* Difficulty badge */}
            {sign.difficulty && (
              <Text
                position={[0, -10, 0]}
                fontSize={3}
                color={color}
                anchorX="center"
                anchorY="middle"
                fontWeight="bold"
              >
                {sign.difficulty.toUpperCase()}
              </Text>
            )}
          </group>
        </Billboard>
      )}
    </group>
  )
}

// Component to render ski trails/runs in 3D - draped onto terrain
function SkiTrail3D({ 
  feature,
  sceneMetadata,
  terrainMesh
}: { 
  feature: {
    id: string
    name: string
    type: 'trail' | 'lift' | 'boundary' | 'area' | 'road'
    difficulty?: string
    geometry: any
    status?: string
  }
  sceneMetadata: SceneMetadata
  terrainMesh: THREE.Mesh
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
  const isLift = feature.type === 'lift'

  useEffect(() => {
    if (!terrainMesh || !feature.geometry) return

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

    // Raycaster for projecting onto terrain
    const raycaster = new THREE.Raycaster()
    const downDirection = new THREE.Vector3(0, -1, 0)

    // Convert and project each point onto terrain
    const projectedPoints: THREE.Vector3[] = []

    coords.forEach((coord: number[]) => {
      const [x, y, z] = geoJsonToSceneCoords(coord, sceneMetadata)
      
      // Raycast from high above down to terrain to get actual Y
      const rayOrigin = new THREE.Vector3(x, 5000, z)
      raycaster.set(rayOrigin, downDirection)
      
      const intersects = raycaster.intersectObject(terrainMesh, false)
      
      let terrainY = y // Fallback to converted elevation
      if (intersects.length > 0) {
        terrainY = intersects[0].point.y + (isLift ? 20 : 3) // Lifts higher, trails just above
      }
      
      projectedPoints.push(new THREE.Vector3(x, terrainY, z))
    })

    if (projectedPoints.length < 2) return

    // Create smooth curve through points
    const curve = new THREE.CatmullRomCurve3(projectedPoints)
    const radius = isLift ? 2 : 4 // Thinner lifts, wider trails
    const segments = Math.max(64, projectedPoints.length * 4)
    const newTubeGeometry = new THREE.TubeGeometry(curve, segments, radius, 8, false)
    
    setTubeGeometry(newTubeGeometry)

    // Calculate midpoint for label
    if (projectedPoints.length > 0) {
      const midIndex = Math.floor(projectedPoints.length / 2)
      setMidpoint(projectedPoints[midIndex])
    }

    return () => {
      newTubeGeometry.dispose()
    }
  }, [feature, sceneMetadata, terrainMesh, isLift])

  if (!tubeGeometry) return null

  return (
    <group frustumCulled>
      <mesh geometry={tubeGeometry} frustumCulled>
        <meshStandardMaterial 
          color={color} 
          emissive={color}
          emissiveIntensity={0.3}
        />
      </mesh>
      {/* Label at midpoint using Billboard + Text */}
      {feature.name && midpoint && (
        <Billboard position={[midpoint.x, midpoint.y + 30, midpoint.z]} follow={true}>
          <mesh position={[0, 0, -0.5]}>
            <planeGeometry args={[feature.name.length * 4 + 16, 12]} />
            <meshBasicMaterial color={isLift ? '#f3f4f6' : '#ffffff'} transparent opacity={0.9} />
          </mesh>
          <Text
            fontSize={4.5}
            color={color}
            anchorX="center"
            anchorY="middle"
            fontWeight="bold"
          >
            {isLift ? `🚡 ${feature.name}` : feature.name}
          </Text>
        </Billboard>
      )}
    </group>
  )
}

// Component to render proximity zones around trails in 3D
function ProximityZone3D({
  feature,
  sceneMetadata,
  terrainMesh,
  proximityThreshold
}: {
  feature: {
    id: string
    geometry: any
    type: string
  }
  sceneMetadata: SceneMetadata
  terrainMesh: THREE.Mesh
  proximityThreshold: number
}) {
  const [bufferGeometry, setBufferGeometry] = useState<THREE.BufferGeometry | null>(null)

  useEffect(() => {
    if (!terrainMesh || !feature.geometry || feature.type !== 'trail') return

    // Dynamically import turf buffer
    import('@turf/turf').then((turf) => {
      const buffer = turf.buffer || (turf as any).default?.buffer
      if (!buffer) {
        console.warn('Turf buffer not available')
        return
      }

      try {
        // Create GeoJSON feature
        const geoJsonFeature: GeoJSON.Feature = {
          type: 'Feature',
          geometry: feature.geometry,
          properties: {}
        }

        // Create buffer around trail
        const buffered = buffer(geoJsonFeature, proximityThreshold, { units: 'meters' })
        
        if (!buffered || buffered.geometry.type !== 'Polygon') return

        // Convert polygon coordinates to 3D points
        const polygon = buffered.geometry as GeoJSON.Polygon
        const coords = polygon.coordinates[0] // Outer ring
        
        const raycaster = new THREE.Raycaster()
        const downDirection = new THREE.Vector3(0, -1, 0)
        const vertices: number[] = []
        const indices: number[] = []

        // Project each point onto terrain
        coords.forEach((coord: number[]) => {
          const [x, y, z] = geoJsonToSceneCoords(coord, sceneMetadata)
          const rayOrigin = new THREE.Vector3(x, 5000, z)
          raycaster.set(rayOrigin, downDirection)
          const intersects = raycaster.intersectObject(terrainMesh, false)
          
          let terrainY = y
          if (intersects.length > 0) {
            terrainY = intersects[0].point.y + 1 // Slightly above terrain
          }
          
          vertices.push(x, terrainY, z)
        })

        // Create triangle indices for polygon
        for (let i = 1; i < vertices.length / 3 - 1; i++) {
          indices.push(0, i, i + 1)
        }

        const geometry = new THREE.BufferGeometry()
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3))
        geometry.setIndex(indices)
        geometry.computeVertexNormals()

        setBufferGeometry(geometry)

        return () => {
          geometry.dispose()
        }
      } catch (err) {
        console.warn(`Failed to create proximity zone for trail ${feature.id}:`, err)
      }
    }).catch((err) => {
      console.warn('Failed to load turf buffer:', err)
    })
  }, [feature, sceneMetadata, terrainMesh, proximityThreshold])

  if (!bufferGeometry) return null

  return (
    <mesh geometry={bufferGeometry} frustumCulled>
      <meshStandardMaterial
        color="#fbbf24"
        transparent
        opacity={0.2}
        side={THREE.DoubleSide}
      />
    </mesh>
  )
}

// Scene3D with terrain, signs, and GeoJSON overlay
function Scene3D({ 
  sceneUrl,
  terrainMeshRef,
  signs,
  discoveredSignIds,
  resortSlug,
  skiFeatures = [],
  showProximityZones = false,
  proximityThreshold = 30,
}: {
  sceneUrl?: string
  terrainMeshRef: React.MutableRefObject<THREE.Mesh | null>
  signs: Sign[]
  discoveredSignIds: Set<string>
  resortSlug: string
  skiFeatures?: Array<{
    id: string
    name: string
    type: 'trail' | 'lift' | 'boundary' | 'area' | 'road'
    difficulty?: string
    geometry: any
    status?: string
  }>
  showProximityZones?: boolean
  proximityThreshold?: number
}) {
  const [sceneMetadata, setSceneMetadata] = useState<SceneMetadata | null>(null)
  const [testGeoJSON, setTestGeoJSON] = useState<GeoJSONFeatureCollection | null>(null)
  const [terrainLoaded, setTerrainLoaded] = useState(false) // Track terrain loading for re-render

  // Load scene metadata
  useEffect(() => {
    loadSceneMetadata('/3d-map/data/index/scene.json').then(setSceneMetadata).catch(() => {
      // Scene metadata load failed, 3D view may not work correctly
    })
  }, [])

  // Load test GeoJSON (TreeBackground - first few polygons only for testing)
  useEffect(() => {
    loadGeoJSONFile('/3d-map/geojson/TreeBackground.geojson')
      .then((data) => {
        if (!data) return
        // Limit to first 10 features for testing performance
        setTestGeoJSON({
          type: 'FeatureCollection',
          features: data.features.slice(0, 10)
        })
      })
      .catch(() => {
        // GeoJSON load failed, continue without it
      })
  }, [])

  return (
    <>
      {/* Terrain Mesh */}
      {sceneUrl && (
        <TerrainMesh 
          sceneUrl={sceneUrl}
          onLoaded={(mesh) => {
            terrainMeshRef.current = mesh
            setTerrainLoaded(true) // Trigger re-render so GeoJSON can drape
          }}
        />
      )}

      {/* Test GeoJSON Polygons - draped onto terrain */}
      {sceneMetadata && terrainLoaded && terrainMeshRef.current && testGeoJSON && testGeoJSON.features.map((feature, index) => {
        if (feature.geometry.type === 'Polygon' || feature.geometry.type === 'MultiPolygon') {
          return (
            <Polygon3D
              key={`test-polygon-${index}`}
              geometry={feature.geometry}
              color="#16a34a" // Green for forest
              sceneMetadata={sceneMetadata}
              terrainMesh={terrainMeshRef.current}
            />
          )
        }
        return null
      })}

      {/* Ski trails/runs from Supabase - draped onto terrain */}
      {sceneMetadata && terrainLoaded && terrainMeshRef.current && skiFeatures
        .filter(f => f.type === 'trail' || f.type === 'lift' || f.type === 'road')
        .map((feature) => (
          <SkiTrail3D
            key={`trail-${feature.id}`}
            feature={feature}
            sceneMetadata={sceneMetadata}
            terrainMesh={terrainMeshRef.current!}
          />
        ))}

      {/* Proximity zones around trails */}
      {showProximityZones && sceneMetadata && terrainLoaded && terrainMeshRef.current && skiFeatures
        .filter(f => f.type === 'trail')
        .map((feature) => (
          <ProximityZone3D
            key={`proximity-${feature.id}`}
            feature={feature}
            sceneMetadata={sceneMetadata}
            terrainMesh={terrainMeshRef.current!}
            proximityThreshold={proximityThreshold}
          />
        ))}

      {/* Sign markers from Supabase - projected onto terrain */}
      {sceneMetadata && terrainLoaded && terrainMeshRef.current && signs.map((sign) => (
        <SignMarker3D
          key={`sign-${sign.id}`}
          sign={sign}
          isFound={discoveredSignIds.has(sign.id)}
          resortSlug={resortSlug}
          sceneMetadata={sceneMetadata}
          terrainMesh={terrainMeshRef.current!}
        />
      ))}

      {/* Fallback ground plane if no terrain */}
      {!sceneUrl && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
          <planeGeometry args={[10000, 10000]} />
          <meshStandardMaterial color="#8B7355" />
        </mesh>
      )}
    </>
  )
}

export default function MapView3D({
  resortSlug,
  signs,
  discoveredSignIds,
  skiFeatures = [],
  resortName = 'Resort',
  onSpeedUpdate,
  sceneUrl,
  center,
  elevationScale = 1,
  additionalGeoJSONPaths,
}: MapView3DProps) {
  const [isTrackingLocation, setIsTrackingLocation] = useState(false)
  const [userLocation, setUserLocation] = useState<[number, number] | null>(null)
  const [userSpeed, setUserSpeed] = useState<number | null>(null)
  const [topSpeed, setTopSpeed] = useState<number>(0)
  const [speedHistory, setSpeedHistory] = useState<number[]>([])
  const [locationError, setLocationError] = useState<string | null>(null)
  const locationWatchIdRef = useRef<number | null>(null)
  const terrainMeshRef = useRef<THREE.Mesh | null>(null)
  const controlsRef = useRef<any>(null)

  // Calculate center from signs, ski features, or use provided center
  const mapCenter: [number, number] = useMemo(() => {
    // Use provided center if available
    if (center) return center
    
    // Calculate from signs if available
    if (signs.length > 0) {
      return [
        signs.reduce((sum, s) => sum + parseFloat(s.lat.toString()), 0) / signs.length,
        signs.reduce((sum, s) => sum + parseFloat(s.lng.toString()), 0) / signs.length,
      ]
    }
    
    // Calculate from ski features if available
    if (skiFeatures && skiFeatures.length > 0) {
      const firstFeature = skiFeatures[0]
      if (firstFeature.geometry?.coordinates) {
        try {
          const coords = firstFeature.geometry.type === 'LineString'
            ? firstFeature.geometry.coordinates
            : firstFeature.geometry.type === 'Polygon'
              ? firstFeature.geometry.coordinates[0]
              : []
          if (coords.length > 0) {
            const avgLng = coords.reduce((sum: number, c: number[]) => sum + c[0], 0) / coords.length
            const avgLat = coords.reduce((sum: number, c: number[]) => sum + c[1], 0) / coords.length
            return [avgLat, avgLng] as [number, number]
          }
        } catch {
          // Fall through to default
        }
      }
    }
    
    // No data available - return a neutral center (0,0)
    // The camera will be repositioned when terrain loads
    return [0, 0]
  }, [center, signs, skiFeatures])

  // Location tracking (similar to 2D map)
  useEffect(() => {
    if (!isTrackingLocation) {
      if (locationWatchIdRef.current !== null) {
        navigator.geolocation.clearWatch(locationWatchIdRef.current)
        locationWatchIdRef.current = null
      }
      setUserLocation(null)
      setUserSpeed(null)
      setTopSpeed(0)
      setSpeedHistory([])
      if (onSpeedUpdate) {
        onSpeedUpdate({ current: null, top: 0, average: 0 })
      }
      return
    }

    if (!navigator.geolocation) {
      setLocationError('Geolocation is not supported by your browser')
      setIsTrackingLocation(false)
      return
    }

    locationWatchIdRef.current = navigator.geolocation.watchPosition(
      (position) => {
        const { latitude, longitude, speed } = position.coords
        setUserLocation([latitude, longitude])
        setLocationError(null)

        if (speed !== null && speed !== undefined && !isNaN(speed)) {
          const speedKmh = speed * 3.6
          setUserSpeed(speedKmh)
          setSpeedHistory((prev) => [...prev, speedKmh].slice(-100))
          setTopSpeed((prev) => (speedKmh > prev ? speedKmh : prev))
        } else {
          setUserSpeed(null)
        }
      },
      () => {
        setLocationError('Unable to get your location')
        setIsTrackingLocation(false)
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0,
      }
    )

    return () => {
      if (locationWatchIdRef.current !== null) {
        navigator.geolocation.clearWatch(locationWatchIdRef.current)
      }
    }
  }, [isTrackingLocation, onSpeedUpdate])

  // Update parent with speed data
  useEffect(() => {
    if (!onSpeedUpdate) return
    const avg = speedHistory.length > 0
      ? speedHistory.reduce((sum, s) => sum + s, 0) / speedHistory.length
      : 0
    onSpeedUpdate({
      current: userSpeed,
      top: topSpeed,
      average: avg,
    })
  }, [userSpeed, topSpeed, speedHistory, onSpeedUpdate])

  const toggleLocationTracking = () => {
    if (!navigator.geolocation) {
      setLocationError('Geolocation is not supported by your browser')
      return
    }

    if (isTrackingLocation) {
      setIsTrackingLocation(false)
    } else {
      navigator.geolocation.getCurrentPosition(
        () => {
          setIsTrackingLocation(true)
          setLocationError(null)
        },
        (error) => {
          let errorMessage = 'Unable to get your location'
          if (error.code === error.PERMISSION_DENIED) {
            errorMessage = 'Location permission denied. Please enable location access in your browser settings.'
          }
          setLocationError(errorMessage)
        },
        {
          enableHighAccuracy: true,
          timeout: 5000,
        }
      )
    }
  }

  // React Three Fiber mode - custom 3D scene with terrain mesh, markers, and trails
  return (
    <div className="relative w-full h-full" style={{ width: '100%', height: '100%', backgroundColor: '#87CEEB', position: 'absolute', top: 0, left: 0 }}>
      <Canvas 
        shadows={false}
        flat // Disable tone mapping for faster rendering
        gl={{ 
          antialias: false, // Disable antialiasing for performance
          powerPreference: 'high-performance',
          stencil: false,
          depth: true,
          alpha: false,
        }}
        dpr={1} // Fixed DPR for consistent performance
        style={{ width: '100%', height: '100%', display: 'block' }}
      >
        {/* Simple lighting for Lambert material */}
        <ambientLight intensity={0.7} />
        <directionalLight position={[1, 1, 1]} intensity={0.8} />
        
        {/* Camera - positioned to see the terrain mesh */}
        <PerspectiveCamera makeDefault position={[8000, 6000, 8000]} fov={60} near={10} far={100000} />
        <OrbitControls
          ref={controlsRef}
          enablePan={true}
          enableZoom={true}
          enableRotate={true}
          minDistance={500}
          maxDistance={50000}
          target={[0, 0, 0]}
        />
        
        {/* Scene3D with terrain, signs, and ski trails */}
        <Scene3D
          sceneUrl={sceneUrl}
          terrainMeshRef={terrainMeshRef}
          signs={signs}
          discoveredSignIds={discoveredSignIds}
          resortSlug={resortSlug}
          skiFeatures={skiFeatures}
          showProximityZones={showProximityZones}
          proximityThreshold={proximityThreshold}
        />
        {/* Auto-position camera based on terrain */}
        <CameraController terrainMesh={terrainMeshRef.current} controlsRef={controlsRef} />
      </Canvas>

      {/* UI Overlay */}
      <div className="absolute top-4 right-4 z-10 flex flex-col gap-2">
        <button
          onClick={toggleLocationTracking}
          className={`rounded-full p-3 shadow-lg hover:shadow-xl transition-all ${
            isTrackingLocation
              ? 'bg-blue-500 text-white'
              : 'bg-white text-gray-700 hover:bg-gray-50'
          }`}
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </button>
      </div>

      {/* Speed display */}
      {isTrackingLocation && userSpeed !== null && (
        <div className="absolute top-20 right-4 z-10 bg-white rounded-lg shadow-lg px-4 py-3">
          <div className="text-lg font-bold">
            {Math.round(userSpeed)} <span className="text-sm font-normal text-gray-500">km/h</span>
          </div>
        </div>
      )}

      {/* Instructions */}
      <div className="absolute bottom-4 left-4 z-10 bg-white/90 rounded-lg shadow-lg p-3 max-w-xs">
        <p className="text-xs text-gray-600">
          <strong>Controls:</strong> Click and drag to rotate, scroll to zoom, right-click to pan
        </p>
      </div>
    </div>
  )
}

