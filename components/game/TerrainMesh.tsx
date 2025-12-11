'use client'

import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { loadSceneMetadata, type SceneMetadata } from '@/lib/utils/terrain-coordinates'

interface TerrainMeshProps {
  sceneUrl?: string
  onLoaded?: (mesh: THREE.Mesh) => void
}

/**
 * Component to load and render terrain mesh from qgisthreejs export
 * Optimized for performance with edge artifact fixing
 */
export default function TerrainMesh({ sceneUrl, onLoaded }: TerrainMeshProps) {
  const [meshData, setMeshData] = useState<{ geometry: THREE.BufferGeometry; material: THREE.Material } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const meshRef = useRef<THREE.Mesh>(null)
  const loadedRef = useRef(false)

  // Load terrain mesh once
  useEffect(() => {
    if (loadedRef.current) return
    loadedRef.current = true

    const loadTerrain = async () => {
      try {
        // Load metadata and geometry in parallel
        const [metadata, geomResponse] = await Promise.all([
          loadSceneMetadata('/3d-map/data/index/scene.json'),
          fetch('/3d-map/data/index/a0.json')
        ])

        if (!geomResponse.ok) {
          throw new Error(`Failed to load terrain geometry: ${geomResponse.statusText}`)
        }

        const geomData = await geomResponse.json()

        if (!geomData.triangles?.v || !geomData.triangles?.f) {
          throw new Error('Invalid terrain geometry format')
        }

        const vertices = geomData.triangles.v as number[]
        const faces = geomData.triangles.f as number[]
        const origin = metadata.origin
        const zScale = metadata.zScale

        // Find valid elevation range to fix edge artifacts
        let minElevation = Infinity
        let maxElevation = -Infinity
        let sumElevation = 0
        let countValid = 0
        
        for (let i = 2; i < vertices.length; i += 3) {
          const vz = vertices[i]
          if (vz > 0) { // Valid elevation (not 0 or negative)
            minElevation = Math.min(minElevation, vz)
            maxElevation = Math.max(maxElevation, vz)
            sumElevation += vz
            countValid++
          }
        }
        
        const avgElevation = countValid > 0 ? sumElevation / countValid : 1500
        // Clamp outliers - anything below 80% of min or above 120% of max is suspect
        const lowerBound = minElevation * 0.8
        const upperBound = maxElevation * 1.2

        // Transform vertices
        const transformedVertices = new Float32Array(vertices.length)
        
        for (let i = 0; i < vertices.length; i += 3) {
          const vx = vertices[i]
          const vy = vertices[i + 1]
          let vz = vertices[i + 2]
          
          // Fix edge artifacts: clamp invalid elevations
          if (!vz || vz <= 0 || vz < lowerBound || vz > upperBound) {
            vz = avgElevation // Use average for invalid points
          }
          
          // Transform to Three.js coordinates (Y-up)
          transformedVertices[i] = vx - origin.x
          transformedVertices[i + 1] = (vz - origin.z) * zScale // Elevation -> Y
          transformedVertices[i + 2] = -(vy - origin.y) // North -> -Z
        }

        // Center the mesh
        let minX = Infinity, minY = Infinity, minZ = Infinity
        let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity
        
        for (let i = 0; i < transformedVertices.length; i += 3) {
          minX = Math.min(minX, transformedVertices[i])
          maxX = Math.max(maxX, transformedVertices[i])
          minY = Math.min(minY, transformedVertices[i + 1])
          maxY = Math.max(maxY, transformedVertices[i + 1])
          minZ = Math.min(minZ, transformedVertices[i + 2])
          maxZ = Math.max(maxZ, transformedVertices[i + 2])
        }
        
        const centerX = (minX + maxX) / 2
        const centerY = (minY + maxY) / 2
        const centerZ = (minZ + maxZ) / 2
        
        for (let i = 0; i < transformedVertices.length; i += 3) {
          transformedVertices[i] -= centerX
          transformedVertices[i + 1] -= centerY
          transformedVertices[i + 2] -= centerZ
        }

        // Create geometry with typed arrays for performance
        const geometry = new THREE.BufferGeometry()
        geometry.setAttribute('position', new THREE.BufferAttribute(transformedVertices, 3))
        geometry.setIndex(faces)
        geometry.computeVertexNormals()
        geometry.computeBoundingSphere()

        // Use MeshBasicMaterial for best performance (no lighting calculations)
        // Or MeshLambertMaterial for a bit of depth with decent performance
        const material = new THREE.MeshLambertMaterial({
          color: '#a89078', // Warm brown terrain color
          side: THREE.FrontSide,
        })

        setMeshData({ geometry, material })
        setLoading(false)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load terrain')
        setLoading(false)
      }
    }

    loadTerrain()
  }, [])

  // Notify parent when mesh is ready
  useEffect(() => {
    if (meshData && meshRef.current && onLoaded) {
      onLoaded(meshRef.current)
    }
  }, [meshData, onLoaded])

  if (error || loading || !meshData) {
    return null
  }

  return (
    <mesh 
      ref={meshRef}
      geometry={meshData.geometry}
      material={meshData.material}
      frustumCulled={false}
    />
  )
}

