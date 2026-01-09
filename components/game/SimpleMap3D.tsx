'use client'

import { useEffect, useRef, useState, useMemo, useCallback } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls, PerspectiveCamera, Billboard, Text } from '@react-three/drei'
import * as THREE from 'three'
import Delaunator from 'delaunator'
import { fromArrayBuffer } from 'geotiff'
import { SkiFeature, GeoJSONLineString } from '@/lib/utils/types'
import { 
  latLngToWebMercator,
  webMercatorToLatLng,
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
  // User run completions with GPS tracks to display as gold lines
  userRunCompletions?: Array<{
    id: string
    gps_track?: { type: 'LineString'; coordinates: Array<[number, number] | [number, number, number]> } | null
    completed_at: string
    ski_feature_id?: string | null
    ski_feature?: { name?: string } | null
  }>
}

// ============================================================================
// SHARED UTILITIES - Extracted to eliminate code duplication
// ============================================================================

/**
 * Check if coordinates have elevation data embedded in them
 */
function coordsHaveElevation(coords: number[][]): boolean {
  for (const coord of coords) {
    if (coord && coord.length > 2 && coord[2] !== undefined && coord[2] !== null && !isNaN(coord[2])) {
      return true
    }
  }
  return false
}

/**
 * Get fallback elevation from feature metadata when coordinates don't have elevation
 */
function getFallbackElevation(feature: SkiFeature): number | null {
  const metadata = feature.metadata
  const metadataElevation = extractElevationFromMetadata(metadata)
  
  if (metadataElevation !== null && typeof metadataElevation === 'number' && !isNaN(metadataElevation)) {
    return metadataElevation
  }
  
  if (metadata?.elevation_min !== undefined || metadata?.elevation_max !== undefined) {
    const min = typeof metadata.elevation_min === 'number' ? metadata.elevation_min : 0
    const max = typeof metadata.elevation_max === 'number' ? metadata.elevation_max : 0
    return (min + max) / 2
  }
  
  if (metadata?.elevation_avg !== undefined && typeof metadata.elevation_avg === 'number') {
    return metadata.elevation_avg
  }
  
  return null
}

/**
 * Get elevation for a specific coordinate, using fallback if needed
 */
function getElevationForCoord(coord: number[], fallbackElevation: number | null): number {
  if (coord.length > 2 && coord[2] !== undefined && coord[2] !== null && !isNaN(coord[2])) {
    return coord[2]
  }
  if (fallbackElevation !== null && !isNaN(fallbackElevation)) {
    return fallbackElevation
  }
  return 0
}

/**
 * Extract coordinates from a feature geometry (handles LineString and MultiLineString)
 */
function extractCoordsFromFeature(feature: SkiFeature): number[][] {
  if (!feature.geometry || !feature.geometry.coordinates) return []
  
  if (feature.geometry.type === 'LineString') {
    return feature.geometry.coordinates
  }
  if (feature.geometry.type === 'MultiLineString') {
    return feature.geometry.coordinates.flat()
  }
  return []
}

/**
 * Calculate circumradius of a triangle (for alpha shape filtering)
 */
function calculateCircumradius(
  p1: { x: number; z: number },
  p2: { x: number; z: number },
  p3: { x: number; z: number }
): number {
  // Calculate side lengths
  const a = Math.sqrt((p2.x - p3.x) ** 2 + (p2.z - p3.z) ** 2)
  const b = Math.sqrt((p1.x - p3.x) ** 2 + (p1.z - p3.z) ** 2)
  const c = Math.sqrt((p1.x - p2.x) ** 2 + (p1.z - p2.z) ** 2)
  
  // Calculate area using cross product
  const area = Math.abs((p2.x - p1.x) * (p3.z - p1.z) - (p3.x - p1.x) * (p2.z - p1.z)) / 2
  
  // Circumradius = (a * b * c) / (4 * area)
  if (area === 0) return Infinity
  return (a * b * c) / (4 * area)
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

// ============================================================================
// TRAIL DETECTION UTILITIES - For camera focus and zoom-to-bounds
// ============================================================================

/**
 * Calculate the center point of a trail feature in 3D scene coordinates
 */
function calculateTrailCenterPoint(
  feature: SkiFeature,
  center: [number, number],
  elevationScale: number
): THREE.Vector3 | null {
  const coords = extractCoordsFromFeature(feature)
  if (coords.length === 0) return null

  const hasElevation = coordsHaveElevation(coords)
  const fallbackElevation = hasElevation ? null : getFallbackElevation(feature)

  let sumX = 0
  let sumY = 0
  let sumZ = 0
  let validCount = 0

  for (const coord of coords) {
    if (!coord || coord.length < 2) continue
    
    const lng = coord[0]
    const lat = coord[1]
    if (isNaN(lng) || isNaN(lat) || !isFinite(lng) || !isFinite(lat)) continue
    
    const elevation = getElevationForCoord(coord, fallbackElevation)
    
    try {
      const [x, y, z] = geoJsonToSimpleSceneCoords([lng, lat, elevation], center, elevationScale)
      if (isNaN(x) || isNaN(y) || isNaN(z) || !isFinite(x) || !isFinite(y) || !isFinite(z)) continue
      
      sumX += x
      sumY += y
      sumZ += z
      validCount++
    } catch {
      // Skip invalid coordinates
    }
  }

  if (validCount === 0) return null

  return new THREE.Vector3(sumX / validCount, sumY / validCount, sumZ / validCount)
}

/**
 * Calculate bounding box of all trails for zoom-to-fit
 */
function calculateTrailBounds(
  skiFeatures: SkiFeature[],
  center: [number, number],
  elevationScale: number
): THREE.Box3 {
  const box = new THREE.Box3()

  for (const feature of skiFeatures) {
    if (feature.type !== 'trail' && feature.type !== 'lift') continue
    
    const coords = extractCoordsFromFeature(feature)
    if (coords.length === 0) continue

    const hasElevation = coordsHaveElevation(coords)
    const fallbackElevation = hasElevation ? null : getFallbackElevation(feature)

    for (const coord of coords) {
      if (!coord || coord.length < 2) continue
      
      const lng = coord[0]
      const lat = coord[1]
      if (isNaN(lng) || isNaN(lat) || !isFinite(lng) || !isFinite(lat)) continue
      
      const elevation = getElevationForCoord(coord, fallbackElevation)
      
      try {
        const [x, y, z] = geoJsonToSimpleSceneCoords([lng, lat, elevation], center, elevationScale)
        if (isNaN(x) || isNaN(y) || isNaN(z) || !isFinite(x) || !isFinite(y) || !isFinite(z)) continue
        
        box.expandByPoint(new THREE.Vector3(x, y, z))
      } catch {
        // Skip invalid coordinates
      }
    }
  }

  return box
}

/**
 * Find trails visible in the camera's view frustum
 */
function findTrailsInViewFrustum(
  camera: THREE.Camera,
  skiFeatures: SkiFeature[],
  center: [number, number],
  elevationScale: number
): SkiFeature[] {
  const frustum = new THREE.Frustum()
  const matrix = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
  frustum.setFromProjectionMatrix(matrix)

  const visibleTrails: SkiFeature[] = []

  for (const feature of skiFeatures) {
    if (feature.type !== 'trail' && feature.type !== 'lift') continue
    
    const coords = extractCoordsFromFeature(feature)
    if (coords.length === 0) continue

    const hasElevation = coordsHaveElevation(coords)
    const fallbackElevation = hasElevation ? null : getFallbackElevation(feature)

    // Check if any point of the trail is in the frustum
    let isVisible = false
    for (const coord of coords) {
      if (!coord || coord.length < 2) continue
      
      const lng = coord[0]
      const lat = coord[1]
      if (isNaN(lng) || isNaN(lat) || !isFinite(lng) || !isFinite(lat)) continue
      
      const elevation = getElevationForCoord(coord, fallbackElevation)
      
      try {
        const [x, y, z] = geoJsonToSimpleSceneCoords([lng, lat, elevation], center, elevationScale)
        if (isNaN(x) || isNaN(y) || isNaN(z) || !isFinite(x) || !isFinite(y) || !isFinite(z)) continue
        
        const point = new THREE.Vector3(x, y, z)
        if (frustum.containsPoint(point)) {
          isVisible = true
          break
        }
      } catch {
        // Skip invalid coordinates
      }
    }

    if (isVisible) {
      visibleTrails.push(feature)
    }
  }

  return visibleTrails
}

/**
 * Find the nearest trail to the screen center (for auto-focus when zooming in)
 */
function findNearestTrailToScreenCenter(
  camera: THREE.PerspectiveCamera,
  skiFeatures: SkiFeature[],
  center: [number, number],
  elevationScale: number,
  screenCenter: { x: number; y: number } = { x: 0.5, y: 0.5 }
): SkiFeature | null {
  if (skiFeatures.length === 0) return null

  // Create a raycaster from screen center
  const raycaster = new THREE.Raycaster()
  const mouse = new THREE.Vector2(
    (screenCenter.x * 2) - 1, // Convert to NDC: 0-1 -> -1 to 1
    -(screenCenter.y * 2) + 1 // Flip Y axis
  )
  raycaster.setFromCamera(mouse, camera)

  let nearestTrail: SkiFeature | null = null
  let nearestDistance = Infinity

  for (const feature of skiFeatures) {
    if (feature.type !== 'trail' && feature.type !== 'lift') continue
    
    const trailCenter = calculateTrailCenterPoint(feature, center, elevationScale)
    if (!trailCenter) continue

    // Calculate distance from ray to trail center
    const distanceToRay = raycaster.ray.distanceToPoint(trailCenter)
    
    // Also consider distance from camera to trail center
    const distanceToCamera = camera.position.distanceTo(trailCenter)
    
    // Combined score: prefer trails closer to ray and closer to camera
    const score = distanceToRay * 0.7 + distanceToCamera * 0.3

    if (score < nearestDistance) {
      nearestDistance = score
      nearestTrail = feature
    }
  }

  return nearestTrail
}

/**
 * Constrain a focus point to stay within trail bounds
 */
function constrainFocusPointToBounds(
  focusPoint: THREE.Vector3,
  bounds: THREE.Box3,
  padding: number = 0.1 // 10% padding
): THREE.Vector3 {
  const size = new THREE.Vector3()
  bounds.getSize(size)
  
  const paddingX = size.x * padding
  const paddingZ = size.z * padding
  
  const constrained = focusPoint.clone()
  constrained.x = Math.max(bounds.min.x + paddingX, Math.min(bounds.max.x - paddingX, constrained.x))
  constrained.z = Math.max(bounds.min.z + paddingZ, Math.min(bounds.max.z - paddingZ, constrained.z))
  // Y can move freely (vertical panning)
  
  return constrained
}

/**
 * Calculate mountain-shaped cone profile from trail bounds
 * Simple: Top is all at highest point, bottom is 6 furthest points in 6 directions
 */
function calculateMountainConeProfile(
  skiFeatures: SkiFeature[],
  center: [number, number],
  elevationScale: number,
  centerPoint: THREE.Vector3,
  minY: number,
  maxY: number
): { 
  radiusByDirection: Map<number, Map<number, number>> // direction -> yLevel -> radius
  minRadius: number
  maxRadius: number
  highestPoint: THREE.Vector3 | null
  bottomPointsByDirection: THREE.Vector3[]
} {
  const NUM_DIRECTIONS = 6
  const Y_SAMPLE_LEVELS = 10 // Sample at 10 different Y levels
  const radiusByDirection = new Map<number, Map<number, number>>()
  
  // Initialize maps for each direction
  for (let dir = 0; dir < NUM_DIRECTIONS; dir++) {
    radiusByDirection.set(dir, new Map<number, number>())
  }
  
  // Collect all trail points
  const allPoints: THREE.Vector3[] = []
  
  for (const feature of skiFeatures) {
    if (feature.type !== 'trail' && feature.type !== 'lift') continue
    
    const coords = extractCoordsFromFeature(feature)
    if (coords.length === 0) continue

    const hasElevation = coordsHaveElevation(coords)
    const fallbackElevation = hasElevation ? null : getFallbackElevation(feature)

    for (const coord of coords) {
      if (!coord || coord.length < 2) continue
      
      const lng = coord[0]
      const lat = coord[1]
      if (isNaN(lng) || isNaN(lat) || !isFinite(lng) || !isFinite(lat)) continue
      
      const elevation = getElevationForCoord(coord, fallbackElevation)
      
      try {
        const [x, y, z] = geoJsonToSimpleSceneCoords([lng, lat, elevation], center, elevationScale)
        if (isNaN(x) || isNaN(y) || isNaN(z) || !isFinite(x) || !isFinite(y) || !isFinite(z)) continue
        
        allPoints.push(new THREE.Vector3(x, y, z))
      } catch {
        // Skip invalid coordinates
      }
    }
  }
  
  if (allPoints.length === 0) {
    // Fallback
    const fallbackRadius = 5000
    for (let dir = 0; dir < NUM_DIRECTIONS; dir++) {
      radiusByDirection.get(dir)!.set(0, fallbackRadius)
      radiusByDirection.get(dir)!.set(Y_SAMPLE_LEVELS - 1, fallbackRadius)
    }
    return { 
      radiusByDirection, 
      minRadius: 500, 
      maxRadius: fallbackRadius,
      highestPoint: null,
      bottomPointsByDirection: []
    }
  }
  
  // Find highest elevation point
  let highestPoint: THREE.Vector3 | null = null
  let highestY = -Infinity
  for (const point of allPoints) {
    if (point.y > highestY) {
      highestY = point.y
      highestPoint = point.clone()
    }
  }
  
  if (!highestPoint) {
    // Fallback
    const fallbackRadius = 5000
    for (let dir = 0; dir < NUM_DIRECTIONS; dir++) {
      radiusByDirection.get(dir)!.set(0, fallbackRadius)
      radiusByDirection.get(dir)!.set(Y_SAMPLE_LEVELS - 1, fallbackRadius)
    }
    return { 
      radiusByDirection, 
      minRadius: 500, 
      maxRadius: fallbackRadius,
      highestPoint: null,
      bottomPointsByDirection: []
    }
  }
  
  // Find 6 furthest points from highestPoint, each in a different direction (60° apart)
  const bottomPointsByDirection: (THREE.Vector3 | null)[] = new Array(NUM_DIRECTIONS).fill(null)
  const maxDistanceByDirection: number[] = new Array(NUM_DIRECTIONS).fill(-Infinity)
  
  // Calculate angle from highestPoint to centerPoint to use as reference (direction 0)
  const dxRef = centerPoint.x - highestPoint.x
  const dzRef = centerPoint.z - highestPoint.z
  const referenceAngle = Math.atan2(dzRef, dxRef)
  
  // Find furthest point from highestPoint in each of the 6 directions
  for (const point of allPoints) {
    const dx = point.x - highestPoint.x
    const dz = point.z - highestPoint.z
    const distance = Math.sqrt(dx * dx + dz * dz)
    
    if (distance === 0) continue // Skip the highest point itself
    
    const angle = Math.atan2(dz, dx)
    
    // Normalize angle relative to reference angle
    let normalizedAngle = angle - referenceAngle
    while (normalizedAngle < 0) normalizedAngle += Math.PI * 2
    while (normalizedAngle >= Math.PI * 2) normalizedAngle -= Math.PI * 2
    
    // Determine which direction (0-5) this point belongs to
    const direction = Math.floor((normalizedAngle / (Math.PI * 2)) * NUM_DIRECTIONS) % NUM_DIRECTIONS
    
    // Check if this is the furthest point in this direction
    if (distance > maxDistanceByDirection[direction]) {
      maxDistanceByDirection[direction] = distance
      bottomPointsByDirection[direction] = point.clone()
    }
  }
  
  // Bottom points: Use actual distance from centerPoint to each furthest point
  const yRange = maxY - minY
  const bottomRadii: number[] = [] // Collect all found bottom radii for averaging
  
  for (let dir = 0; dir < NUM_DIRECTIONS; dir++) {
    const bottomPoint = bottomPointsByDirection[dir]
    if (bottomPoint) {
      // Distance from centerPoint to this bottom point
      const dx = bottomPoint.x - centerPoint.x
      const dz = bottomPoint.z - centerPoint.z
      const distance = Math.sqrt(dx * dx + dz * dz)
      
      bottomRadii.push(distance) // Collect for averaging
      
      // Map this point's Y (its actual elevation) to a sample level
      const yLevel = yRange > 0 
        ? Math.round(((bottomPoint.y - minY) / yRange) * (Y_SAMPLE_LEVELS - 1))
        : Y_SAMPLE_LEVELS - 1
      const clampedYLevel = Math.max(0, Math.min(Y_SAMPLE_LEVELS - 1, yLevel))
      
      // Set radius at this point's actual Y elevation
      radiusByDirection.get(dir)!.set(clampedYLevel, distance)
      
      // Also set at bottom level for interpolation
      radiusByDirection.get(dir)!.set(Y_SAMPLE_LEVELS - 1, distance)
    }
  }
  
  // Calculate average of found bottom radii for fallback and top radius calculation
  const averageBottomRadius = bottomRadii.length > 0
    ? bottomRadii.reduce((sum, r) => sum + r, 0) / bottomRadii.length
    : 5000 // Fallback if no bottom points found
  
  // Use average for directions with no bottom point (improved fallback)
  for (let dir = 0; dir < NUM_DIRECTIONS; dir++) {
    if (!bottomPointsByDirection[dir]) {
      // Use average of found bottom radii instead of arbitrary value
      radiusByDirection.get(dir)!.set(Y_SAMPLE_LEVELS - 1, averageBottomRadius)
    }
  }
  
  // Top points: Use small percentage of average bottom radius to create true cone (not dome)
  // This creates a pointy cone top instead of a flat circular dome
  const TOP_RADIUS_PERCENTAGE = 0.03 // 3% of average bottom radius for cone top
  const topRadius = averageBottomRadius * TOP_RADIUS_PERCENTAGE
  
  // All top points use the same small radius (creates pointy cone top)
  for (let dir = 0; dir < NUM_DIRECTIONS; dir++) {
    radiusByDirection.get(dir)!.set(0, topRadius) // Level 0 = top (at highest point)
  }
  
  // Interpolate between top and bottom for intermediate Y levels
  for (let dir = 0; dir < NUM_DIRECTIONS; dir++) {
    const topRadiusForDir = radiusByDirection.get(dir)!.get(0) || topRadius
    const bottomRadiusForDir = radiusByDirection.get(dir)!.get(Y_SAMPLE_LEVELS - 1) || averageBottomRadius
    
    for (let yLevel = 1; yLevel < Y_SAMPLE_LEVELS - 1; yLevel++) {
      const t = yLevel / (Y_SAMPLE_LEVELS - 1) // 0 to 1 from top to bottom
      const interpolatedRadius = topRadiusForDir + (bottomRadiusForDir - topRadiusForDir) * t
      radiusByDirection.get(dir)!.set(yLevel, interpolatedRadius)
    }
  }
  
  // Find overall min and max radii
  let overallMin = Infinity
  let overallMax = -Infinity
  
  for (let dir = 0; dir < NUM_DIRECTIONS; dir++) {
    const dirMap = radiusByDirection.get(dir)!
    for (const radius of dirMap.values()) {
      overallMin = Math.min(overallMin, radius)
      overallMax = Math.max(overallMax, radius)
    }
  }
  
  if (overallMin === Infinity) {
    overallMin = 500
    overallMax = 5000
  }
  
  return {
    radiusByDirection,
    minRadius: overallMin,
    maxRadius: overallMax,
    highestPoint,
    bottomPointsByDirection: bottomPointsByDirection.filter(p => p !== null) as THREE.Vector3[]
  }
}

/**
 * Get radius for a specific direction and Y level from the mountain cone profile
 * Interpolates between sample levels
 */
function getRadiusForDirectionAndY(
  radiusByDirection: Map<number, Map<number, number>>,
  direction: number,
  y: number,
  minY: number,
  maxY: number,
  numSampleLevels: number
): number {
  const yRange = maxY - minY
  if (yRange <= 0) {
    const dirMap = radiusByDirection.get(direction % 6)
    return dirMap?.get(0) || 5000
  }
  
  // Convert Y to sample level (0 to numSampleLevels-1)
  const yProgress = Math.max(0, Math.min(1, (maxY - y) / yRange))
  const exactLevel = yProgress * (numSampleLevels - 1)
  const lowerLevel = Math.floor(exactLevel)
  const upperLevel = Math.ceil(exactLevel)
  const t = exactLevel - lowerLevel
  
  const dirMap = radiusByDirection.get(direction % 6)
  if (!dirMap) return 5000
  
  const lowerRadius = dirMap.get(lowerLevel) || dirMap.get(0) || 5000
  const upperRadius = dirMap.get(upperLevel) || dirMap.get(numSampleLevels - 1) || 5000
  
  // Linear interpolation
  return lowerRadius * (1 - t) + upperRadius * t
}

/**
 * Get radius for a specific angle (not direction index) by interpolating between adjacent directions
 * This creates a smooth cone surface instead of a hexagon
 */
function getRadiusForAngleAndY(
  radiusByDirection: Map<number, Map<number, number>>,
  angle: number,
  y: number,
  minY: number,
  maxY: number,
  numSampleLevels: number,
  numDirections: number = 6
): number {
  // Normalize angle to 0-2π
  const normalizedAngle = ((angle % (Math.PI * 2)) + (Math.PI * 2)) % (Math.PI * 2)
  
  // Convert angle to direction index (0 to numDirections-1, floating point)
  const directionFloat = (normalizedAngle / (Math.PI * 2)) * numDirections
  
  // Get the two adjacent direction indices
  const lowerDir = Math.floor(directionFloat) % numDirections
  const upperDir = (lowerDir + 1) % numDirections
  
  // Interpolation factor between the two directions (0 to 1)
  const dirT = directionFloat - Math.floor(directionFloat)
  
  // Get radius for each direction at this Y level
  const radius1 = getRadiusForDirectionAndY(radiusByDirection, lowerDir, y, minY, maxY, numSampleLevels)
  const radius2 = getRadiusForDirectionAndY(radiusByDirection, upperDir, y, minY, maxY, numSampleLevels)
  
  // Interpolate between the two directions
  return radius1 * (1 - dirT) + radius2 * dirT
}

/**
 * Apply cone-shaped constraint to focus point
 * Projects the point onto the cone surface based on its Y position
 * Top has a minimum radius (dome) to prevent jittery behavior
 * 
 * @param focusPoint Current focus point
 * @param centerPoint Center point of the cone (mountain center)
 * @param maxY Maximum Y value (top of cone)
 * @param minY Minimum Y value (bottom of cone)
 * @param maxRadius Maximum horizontal radius at bottom of cone
 * @returns Constrained focus point on cone surface
 */
function applyConeConstraint(
  focusPoint: THREE.Vector3,
  centerPoint: THREE.Vector3,
  maxY: number,
  minY: number,
  maxRadius: number
): THREE.Vector3 {
  const constrained = focusPoint.clone()
  
  // Clamp Y to valid range
  constrained.y = Math.max(minY, Math.min(maxY, focusPoint.y))
  
  // Calculate how far down we are (0 = top, 1 = bottom)
  const yRange = maxY - minY
  if (yRange <= 0) {
    // No range, use minimum radius for small circle at top
    const minRadius = maxRadius * 0.05 // 5% of max radius at top
    const dx = focusPoint.x - centerPoint.x
    const dz = focusPoint.z - centerPoint.z
    const currentDistance = Math.sqrt(dx * dx + dz * dz)
    
    if (currentDistance > 0) {
      const angle = Math.atan2(dz, dx)
      constrained.x = centerPoint.x + Math.cos(angle) * minRadius
      constrained.z = centerPoint.z + Math.sin(angle) * minRadius
    } else {
      constrained.x = centerPoint.x + minRadius
      constrained.z = centerPoint.z
    }
    return constrained
  }
  
  const yProgress = Math.max(0, Math.min(1, (maxY - constrained.y) / yRange))
  
  // Calculate radius at this Y level (cone surface with dome at top)
  // At top (yProgress = 0): radius = minRadius (small circle/dome, not zero)
  // At bottom (yProgress = 1): radius = maxRadius (full movement)
  const minRadius = maxRadius * 0.05 // 5% of max radius for dome at top
  const coneRadius = minRadius + (maxRadius - minRadius) * yProgress
  
  // Calculate current horizontal distance from center
  const dx = focusPoint.x - centerPoint.x
  const dz = focusPoint.z - centerPoint.z
  const currentDistance = Math.sqrt(dx * dx + dz * dz)
  
  // Project onto cone surface (always has at least minRadius)
  if (currentDistance > 0) {
    // Project to cone surface: maintain direction, set to cone radius
    const angle = Math.atan2(dz, dx)
    constrained.x = centerPoint.x + Math.cos(angle) * coneRadius
    constrained.z = centerPoint.z + Math.sin(angle) * coneRadius
  } else {
    // At center, move to edge of cone at this Y level
    constrained.x = centerPoint.x + coneRadius
    constrained.z = centerPoint.z
  }
  
  return constrained
}

/**
 * Apply mountain-shaped cone constraint to focus point
 * Uses irregular cone profile based on actual trail bounds
 * 
 * @param focusPoint Current focus point
 * @param centerPoint Center point of the cone (mountain center)
 * @param maxY Maximum Y value (top of cone)
 * @param minY Minimum Y value (bottom of cone)
 * @param radiusByDirection Map of direction -> yLevel -> radius
 * @param numSampleLevels Number of Y sample levels used
 * @returns Constrained focus point on cone surface
 */
function applyMountainConeConstraint(
  focusPoint: THREE.Vector3,
  centerPoint: THREE.Vector3,
  maxY: number,
  minY: number,
  radiusByDirection: Map<number, Map<number, number>>,
  numSampleLevels: number = 10,
  lowestConePointY?: number,  // Optional: the Y of the lowest cone bottom point
  maxRadius?: number  // Optional: maximum radius for minimum radius calculation
): THREE.Vector3 {
  const constrained = focusPoint.clone()
  
  // Clamp Y to valid range
  // If we have a lowest cone point Y, don't let the red dot go below it
  const effectiveMinY = lowestConePointY !== undefined ? lowestConePointY : minY
  constrained.y = Math.max(effectiveMinY, Math.min(maxY, focusPoint.y))
  
  // Calculate direction from center
  const dx = focusPoint.x - centerPoint.x
  const dz = focusPoint.z - centerPoint.z
  const angle = Math.atan2(dz, dx)
  
  // Get radius for this angle and Y level using smooth interpolation between directions
  let radius = getRadiusForAngleAndY(
    radiusByDirection,
    angle,
    constrained.y,
    minY,
    maxY,
    numSampleLevels,
    6 // numDirections
  )
  
  // Add minimum radius constraint to prevent jittery behavior at top
  // Calculate maxRadius from map if not provided
  let effectiveMaxRadius = maxRadius
  if (effectiveMaxRadius === undefined) {
    // Calculate maxRadius from radiusByDirection map
    effectiveMaxRadius = 0
    for (const dirMap of radiusByDirection.values()) {
      for (const r of dirMap.values()) {
        effectiveMaxRadius = Math.max(effectiveMaxRadius, r)
      }
    }
  }
  
  // Apply minimum radius (2% of maxRadius) to prevent jittery behavior at top
  const MIN_RADIUS_PERCENTAGE = 0.02 // 2% minimum to prevent jittery behavior
  const minRadius = effectiveMaxRadius * MIN_RADIUS_PERCENTAGE
  radius = Math.max(minRadius, radius)
  
  // Project point onto cone surface at this radius
  const currentDistance = Math.sqrt(dx * dx + dz * dz)
  
  if (currentDistance > 0) {
    // Maintain direction, set to cone radius
    constrained.x = centerPoint.x + Math.cos(angle) * radius
    constrained.z = centerPoint.z + Math.sin(angle) * radius
  } else {
    // At center, move to edge of cone in first direction
    const defaultAngle = 0
    constrained.x = centerPoint.x + Math.cos(defaultAngle) * radius
    constrained.z = centerPoint.z + Math.sin(defaultAngle) * radius
  }
  
  return constrained
}

/**
 * Smooth easing function for transitions (ease-in-out cubic)
 */
function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

/**
 * Calculate camera position and target to fit all trails in view
 */
function calculateZoomToFitBounds(
  bounds: THREE.Box3,
  camera: THREE.PerspectiveCamera,
  focusPoint: THREE.Vector3
): { position: THREE.Vector3; target: THREE.Vector3 } {
  const size = new THREE.Vector3()
  bounds.getSize(size)
  
  // Calculate the maximum dimension
  const maxDim = Math.max(size.x, size.y, size.z)
  
  // Calculate distance needed to fit bounds in view
  // Using FOV to determine required distance
  const fov = camera.fov * (Math.PI / 180)
  const distance = (maxDim / 2) / Math.tan(fov / 2) * 1.5 // 1.5x padding
  
  // Calculate center of bounds
  const center = new THREE.Vector3()
  bounds.getCenter(center)
  
  // Position camera at an angle looking at the center
  const angle = Math.PI / 4 // 45 degrees
  const height = distance * 0.6
  
  const position = new THREE.Vector3(
    center.x + distance * Math.cos(angle),
    center.y + height,
    center.z + distance * Math.sin(angle)
  )
  
  return {
    position,
    target: center.clone()
  }
}


// Difficulty colors (matching ski trail standards)
const DIFFICULTY_COLORS: Record<string, string> = {
  'green': '#22c55e',      // Green - easiest
  'blue': '#3b82f6',       // Blue - intermediate  
  'black': '#1f2937',      // Black - advanced
  'double-black': '#ef4444', // Double black - expert
  'terrain-park': '#f97316', // Orange - terrain park
  'other': '#6b7280',      // Gray - other
}

// Get color based on feature type and difficulty
function getFeatureColor(feature: SkiFeature, isUserRun: boolean = false): string {
  if (isUserRun) return '#ffd700' // Gold for user runs
  if (feature.type === 'lift') return '#dc2626' // Red for lifts
  if (feature.type === 'boundary') return '#ec4899' // Pink for boundaries
  if (feature.type === 'road') return '#78716c' // Stone color for roads
  if (feature.difficulty) return DIFFICULTY_COLORS[feature.difficulty] || '#6b7280'
  return '#6b7280' // Default gray
}

// Component to render a single ski trail/run in 3D using elevation from coordinates
function SimpleTrail3D({
  feature,
  center,
  elevationScale,
  isUserRun = false
}: {
  feature: SkiFeature
  center: [number, number]
  elevationScale: number
  isUserRun?: boolean
}) {
  const [lineObject, setLineObject] = useState<THREE.Line | null>(null)

  const color = getFeatureColor(feature, isUserRun)

  useEffect(() => {
    const coords = extractCoordsFromFeature(feature)
    if (coords.length < 2) return

    try {
      // Get fallback elevation if coords don't have it embedded
      const hasElevation = coordsHaveElevation(coords)
      const fallbackElevation = hasElevation ? null : getFallbackElevation(feature)

      // Convert coordinates to 3D points
      const allPoints: THREE.Vector3[] = []
      
      for (const coord of coords) {
        if (!coord || coord.length < 2) continue
        
        const lng = coord[0]
        const lat = coord[1]
        if (isNaN(lng) || isNaN(lat) || !isFinite(lng) || !isFinite(lat)) continue
        
        const elevation = getElevationForCoord(coord, fallbackElevation)
        
        try {
          const [x, y, z] = geoJsonToSimpleSceneCoords([lng, lat, elevation], center, elevationScale)
          if (isNaN(x) || isNaN(y) || isNaN(z) || !isFinite(x) || !isFinite(y) || !isFinite(z)) continue
          allPoints.push(new THREE.Vector3(x, y, z))
        } catch {
          // Skip invalid coordinates
        }
      }

      if (allPoints.length < 2) return

      // Limit points per trail for performance
      const MAX_POINTS_PER_TRAIL = 200
      let points = allPoints
      if (allPoints.length > MAX_POINTS_PER_TRAIL) {
        const step = Math.ceil(allPoints.length / MAX_POINTS_PER_TRAIL)
        const sampledPoints: THREE.Vector3[] = []
        for (let i = 0; i < allPoints.length; i += step) {
          sampledPoints.push(allPoints[i])
        }
        // Always include first and last points
        sampledPoints[0] = allPoints[0]
        sampledPoints[sampledPoints.length - 1] = allPoints[allPoints.length - 1]
        points = sampledPoints
      }

      // Add Y offset to ensure trails stay on top of mesh
      // Lifts get a much higher offset to appear elevated like real ski lifts
      // User runs get a slightly higher offset to be visible above regular trails
      const yOffset = feature.type === 'lift' ? 40 : (isUserRun ? 10 : 5)
      const offsetPoints = points.map(p => new THREE.Vector3(p.x, p.y + yOffset, p.z))
      const geometry = new THREE.BufferGeometry().setFromPoints(offsetPoints)
      
      // Create material and line object
      const material = new THREE.LineBasicMaterial({ 
        color, 
        linewidth: feature.type === 'lift' ? 2 : (isUserRun ? 6 : 4), // Thicker for user runs
        depthTest: true,
        depthWrite: true // Write to depth buffer so lines are visible
      })
      
      const line = new THREE.Line(geometry, material)
      setLineObject(line)

      return () => {
        geometry.dispose()
        material.dispose()
      }
    } catch (error) {
      console.error(`Error rendering trail "${feature.name}":`, error)
      setLineObject(null)
    }
  }, [feature, center, elevationScale, color, isUserRun])

  if (!lineObject) return null

  return (
    <group frustumCulled renderOrder={10}>
      <primitive object={lineObject} frustumCulled />
    </group>
  )
}


// Camera controller with dynamic focus points and smart zoom behavior
// Supports orbit rotation around focus point with constraints
function CameraController({ 
  skiFeatures, 
  center, 
  controlsRef,
  elevationScale,
  offsetY = -250,
  screenTargetPosition = [0.5, 0.5], // [x, y] - only y (vertical) is used, x is ignored (kept centered)
  onConeParamsChange
}: { 
  skiFeatures: SkiFeature[]
  center: [number, number]
  controlsRef: React.MutableRefObject<any>
  elevationScale: number
  offsetY?: number // Vertical offset to apply to tracking point (negative values lower the point)
  screenTargetPosition?: [number, number] // [x, y] - only y controls vertical screen position (0-1), where 0.5 is center
  onConeParamsChange?: (params: { 
    centerPoint: THREE.Vector3 | null
    maxY: number
    minY: number
    maxRadius: number
    mountainConeProfile?: {
      radiusByDirection: Map<number, Map<number, number>>
      minRadius: number
      maxRadius: number
      highestPoint: THREE.Vector3 | null
      bottomPointsByDirection: THREE.Vector3[]
    }
  }) => void
}) {
  const { camera, size } = useThree()
  const [highestPoint, setHighestPoint] = useState<THREE.Vector3 | null>(null)
  const [bounds, setBounds] = useState<THREE.Box3 | null>(null)
  const [trailBounds, setTrailBounds] = useState<THREE.Box3 | null>(null)
  const [mountainCenterPoint, setMountainCenterPoint] = useState<THREE.Vector3 | null>(null)
  const [focusMode, setFocusMode] = useState<'mountain-center' | 'trail-focused' | 'auto'>('auto')
  const [isTransitioning, setIsTransitioning] = useState(false)
  
  // Zoom thresholds for switching focus modes
  const ZOOM_OUT_THRESHOLD = 15000 // Distance where we switch to "fit all trails" mode
  const ZOOM_IN_THRESHOLD = 5000   // Distance where we switch to "focus on trail" mode

  useEffect(() => {
    try {
      // Calculate bounding box and find highest point from all trails
      const tempBox = new THREE.Box3()
      let hasPoints = false
      let maxY = -Infinity
      let highestPointVec: THREE.Vector3 | null = null

      for (const feature of skiFeatures) {
        const coords = extractCoordsFromFeature(feature)
        if (coords.length === 0) continue

        const hasElevation = coordsHaveElevation(coords)
        const fallbackElevation = hasElevation ? null : getFallbackElevation(feature)

        for (const coord of coords) {
          if (!coord || coord.length < 2) continue
          
          const lng = coord[0]
          const lat = coord[1]
          if (isNaN(lng) || isNaN(lat) || !isFinite(lng) || !isFinite(lat)) continue
          
          const elevation = getElevationForCoord(coord, fallbackElevation)
          
          try {
            const [x, y, z] = geoJsonToSimpleSceneCoords([lng, lat, elevation], center, elevationScale)
            if (isNaN(x) || isNaN(y) || isNaN(z) || !isFinite(x) || !isFinite(y) || !isFinite(z)) continue
            
            const point = new THREE.Vector3(x, y, z)
            tempBox.expandByPoint(point)
            hasPoints = true

            if (y > maxY) {
              maxY = y
              highestPointVec = point.clone()
            }
          } catch {
            // Skip invalid coordinates
          }
        }
      }

      if (hasPoints) {
        setBounds(tempBox)
        if (highestPointVec) {
          setHighestPoint(highestPointVec)
          
          // Calculate mountain center point (highest point with Y offset)
          const centerPoint = highestPointVec.clone()
          centerPoint.y -= offsetY
          setMountainCenterPoint(centerPoint)
        }
      }
      
      // Calculate trail bounds for focus point constraints
      const trails = calculateTrailBounds(skiFeatures, center, elevationScale)
      setTrailBounds(trails)
    } catch (error) {
      console.error('Error calculating camera bounds:', error)
    }
  }, [skiFeatures, center, elevationScale, offsetY])

  // Initialize camera position and focus point
  useEffect(() => {
    if (!highestPoint || !bounds || !mountainCenterPoint) return

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

      const distance = maxDim * 0.2

      // Calculate height difference
      const heightDifference = highestPoint.y - mountainCenterPoint.y

      // Position camera at the standard position
      const baseDistance = distance * 0.8
      const cameraX = mountainCenterPoint.x + baseDistance
      const cameraY = mountainCenterPoint.y + baseDistance + heightDifference * 1.5 + 1500
      const cameraZ = mountainCenterPoint.z + baseDistance
      
      camera.position.set(cameraX, cameraY, cameraZ)

      if (controlsRef.current) {
        controlsRef.current.target.copy(mountainCenterPoint)
        controlsRef.current.update()
      }
    } catch (error) {
      console.error('Error positioning camera:', error)
    }
  }, [highestPoint, bounds, mountainCenterPoint, camera, controlsRef])

  // Track previous zoom distance to detect zoom-out events
  const previousDistanceRef = useRef<number | null>(null)

  // Monitor zoom level and update focus mode accordingly
  useEffect(() => {
    if (!controlsRef.current || !mountainCenterPoint || !trailBounds || !bounds) return

    const checkZoomAndUpdateFocus = () => {
      const distance = camera.position.distanceTo(controlsRef.current.target)
      const previousDistance = previousDistanceRef.current
      
      // Determine focus mode based on zoom distance
      let newFocusMode: 'mountain-center' | 'trail-focused' | 'auto' = focusMode
      
      if (distance > ZOOM_OUT_THRESHOLD) {
        // Zoomed out: focus on mountain center
        newFocusMode = 'mountain-center'
        
        // If user just zoomed out past threshold, trigger zoom-to-fit
        if (previousDistance !== null && previousDistance <= ZOOM_OUT_THRESHOLD && distance > ZOOM_OUT_THRESHOLD) {
          // User zoomed out past threshold - fit all trails
          if (trailBounds && !trailBounds.isEmpty() && 'fov' in camera) {
            setIsTransitioning(true)
            const zoomToFit = calculateZoomToFitBounds(trailBounds, camera as THREE.PerspectiveCamera, mountainCenterPoint)
            
            // Smoothly animate camera to fit bounds
            const startPos = camera.position.clone()
            const startTarget = controlsRef.current.target.clone()
            const duration = 1000 // 1 second
            const startTime = Date.now()
            
            const animate = () => {
              const elapsed = Date.now() - startTime
              const progress = Math.min(elapsed / duration, 1)
              const eased = easeInOutCubic(progress)
              
              camera.position.lerpVectors(startPos, zoomToFit.position, eased)
              controlsRef.current.target.lerpVectors(startTarget, zoomToFit.target, eased)
              controlsRef.current.update()
              
              if (progress < 1) {
                requestAnimationFrame(animate)
              } else {
                setIsTransitioning(false)
              }
            }
            
            animate()
          }
        }
      } else if (distance < ZOOM_IN_THRESHOLD) {
        // Zoomed in: try to focus on nearest trail
        newFocusMode = 'trail-focused'
      } else {
        // Middle range: auto mode (allow user control)
        newFocusMode = 'auto'
      }

      if (newFocusMode !== focusMode) {
        setFocusMode(newFocusMode)
      }
      
      previousDistanceRef.current = distance
    }

    // Check periodically (every frame would be too expensive)
    const interval = setInterval(checkZoomAndUpdateFocus, 100)
    return () => clearInterval(interval)
  }, [camera, controlsRef, mountainCenterPoint, trailBounds, bounds, focusMode, isTransitioning])

  // Calculate Y range for cone constraint
  const [yRange, setYRange] = useState<{ min: number; max: number } | null>(null)
  const [maxConeRadius, setMaxConeRadius] = useState<number>(0)
  const [mountainConeProfile, setMountainConeProfile] = useState<{
    radiusByDirection: Map<number, Map<number, number>>
    minRadius: number
    maxRadius: number
    highestPoint: THREE.Vector3 | null
    bottomPointsByDirection: THREE.Vector3[]
  } | null>(null)

  // Calculate Y range and mountain cone profile from trail bounds
  useEffect(() => {
    if (!trailBounds || trailBounds.isEmpty() || !mountainCenterPoint) return

    const size = new THREE.Vector3()
    trailBounds.getSize(size)
    
    // Y range: from highest point to lowest point in trails
    const maxY = trailBounds.max.y
    const minY = trailBounds.min.y
    
    setYRange({ min: minY, max: maxY })
    
    // Calculate irregular mountain cone profile based on actual trail bounds
    const profile = calculateMountainConeProfile(
      skiFeatures,
      center,
      elevationScale,
      mountainCenterPoint,
      minY,
      maxY
    )
    
    setMountainConeProfile(profile)
    setMaxConeRadius(profile.maxRadius)
    
    // Notify parent of cone parameters for visualization
    if (onConeParamsChange) {
      onConeParamsChange({
        centerPoint: mountainCenterPoint,
        maxY: maxY,
        minY: minY,
        maxRadius: profile.maxRadius,
        mountainConeProfile: profile
      })
    }
  }, [trailBounds, mountainCenterPoint, skiFeatures, center, elevationScale, onConeParamsChange])

  // When cone profile is ready, project the target to the cone surface
  const hasInitializedTargetRef = useRef(false)
  useEffect(() => {
    if (!mountainConeProfile || !yRange || !mountainCenterPoint || !controlsRef.current) return
    if (hasInitializedTargetRef.current) return // Only run once
    
    const target = controlsRef.current.target
    
    // Find the lowest Y from the 6 bottom points
    const lowestConePointY = mountainConeProfile.bottomPointsByDirection.length > 0
      ? Math.min(...mountainConeProfile.bottomPointsByDirection.map(p => p.y))
      : undefined
    
    // Project target to cone surface
    const constrained = applyMountainConeConstraint(
      target,
      mountainCenterPoint,
      yRange.max,
      yRange.min,
      mountainConeProfile.radiusByDirection,
      10,
      lowestConePointY,
      mountainConeProfile.maxRadius
    )
    
    target.x = constrained.x
    target.y = constrained.y
    target.z = constrained.z
    controlsRef.current.update()
    hasInitializedTargetRef.current = true
    // Note: Don't call setCurrentFocusPoint here - useFrame will handle it
  }, [mountainConeProfile, yRange, mountainCenterPoint])

  // Track drag state and position for cone surface movement
  const dragStartRef = useRef<{ x: number; y: number; targetY: number; targetAngle: number } | null>(null)
  const isDraggingRef = useRef(false)
  const currentMousePosRef = useRef<{ x: number; y: number } | null>(null)

  // Listen to mouse and touch events to track drag
  useEffect(() => {
    if (!controlsRef.current) return

    const controls = controlsRef.current
    const domElement = controls.domElement || controls.object?.domElement
    
    if (!domElement) return
    
    const handleStart = (clientX: number, clientY: number) => {
      if (!controlsRef.current?.target || !mountainCenterPoint || !yRange) return
      
      const target = controlsRef.current.target
      
      // Calculate current angle from center
      const dx = target.x - mountainCenterPoint.x
      const dz = target.z - mountainCenterPoint.z
      const currentAngle = Math.atan2(dz, dx)
      
      isDraggingRef.current = true
      dragStartRef.current = {
        x: clientX,
        y: clientY,
        targetY: target.y,
        targetAngle: currentAngle
      }
    }
    
    const handleMove = (clientX: number, clientY: number) => {
      if (isDraggingRef.current) {
        currentMousePosRef.current = { x: clientX, y: clientY }
      }
    }
    
    const handleEnd = () => {
      isDraggingRef.current = false
      dragStartRef.current = null
      currentMousePosRef.current = null
    }
    
    // Mouse events
    const handleMouseDown = (e: MouseEvent) => {
      // Left button without modifiers (main button for rotation)
      if (e.button === 0 && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
        handleStart(e.clientX, e.clientY)
      }
    }
    
    const handleMouseMove = (e: MouseEvent) => {
      handleMove(e.clientX, e.clientY)
    }
    
    const handleMouseUp = () => {
      handleEnd()
    }
    
    // Touch events
    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 1) {
        const touch = e.touches[0]
        handleStart(touch.clientX, touch.clientY)
      }
    }
    
    const handleTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 1 && isDraggingRef.current) {
        const touch = e.touches[0]
        handleMove(touch.clientX, touch.clientY)
      }
    }
    
    const handleTouchEnd = () => {
      handleEnd()
    }

    domElement.addEventListener('mousedown', handleMouseDown)
    domElement.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    domElement.addEventListener('touchstart', handleTouchStart)
    domElement.addEventListener('touchmove', handleTouchMove)
    domElement.addEventListener('touchend', handleTouchEnd)
    domElement.addEventListener('touchcancel', handleTouchEnd)

    return () => {
      domElement.removeEventListener('mousedown', handleMouseDown)
      domElement.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      domElement.removeEventListener('touchstart', handleTouchStart)
      domElement.removeEventListener('touchmove', handleTouchMove)
      domElement.removeEventListener('touchend', handleTouchEnd)
      domElement.removeEventListener('touchcancel', handleTouchEnd)
    }
  }, [controlsRef, mountainCenterPoint, yRange])

  // Helper function to update camera position and angle based on cone position
  const updateCameraPositionForCone = useCallback((
    focusPoint: THREE.Vector3,
    focusY: number,
    yRange: { min: number; max: number },
    centerPoint: THREE.Vector3,
    cam: THREE.Camera
  ) => {
    // Calculate how far down the cone we are (0 = top, 1 = bottom)
    const yRangeSize = yRange.max - yRange.min
    const yProgress = yRangeSize > 0 ? Math.max(0, Math.min(1, (yRange.max - focusY) / yRangeSize)) : 0.5
    
      // Calculate camera distance from focus point
      // Distance increases slightly as we move down, but not too much at bottom
      const baseDistance = 6000
      const distance = baseDistance + (yProgress * 2000) // 6000 to 8000 (reduced from 8000-12000)
    
    // Calculate camera polar angle based on Y position
    // At top (yProgress = 0): polar angle = ~30 degrees (looking up at mountain from side)
    // At bottom (yProgress = 1): polar angle = ~90 degrees (looking straight down)
    // In Three.js, polar angle 0 = up (Y+), PI/2 = horizontal, PI = down (Y-)
    // But we want: 0 at top = looking from side (~30 deg from horizontal), 1 at bottom = looking down (~90 deg)
    const minPolarAngle = Math.PI / 6   // ~30 degrees from horizontal (looking up)
    const maxPolarAngle = Math.PI / 2.05 // ~88 degrees (almost straight down)
    const polarAngle = minPolarAngle + (yProgress * (maxPolarAngle - minPolarAngle))
    
    // Calculate horizontal (azimuth) angle from center to focus point
    const dx = focusPoint.x - centerPoint.x
    const dz = focusPoint.z - centerPoint.z
    const azimuthAngle = Math.atan2(dz, dx)
    
    // Convert polar coordinates to Cartesian
    // In Three.js: X = r * sin(polar) * cos(azimuth), Y = r * cos(polar), Z = r * sin(polar) * sin(azimuth)
    const cameraOffset = new THREE.Vector3(
      Math.sin(polarAngle) * Math.cos(azimuthAngle) * distance,
      Math.cos(polarAngle) * distance,
      Math.sin(polarAngle) * Math.sin(azimuthAngle) * distance
    )
    
    const newCameraPos = new THREE.Vector3(
      focusPoint.x + cameraOffset.x,
      focusPoint.y + cameraOffset.y,
      focusPoint.z + cameraOffset.z
    )
    
    cam.position.copy(newCameraPos)
    cam.lookAt(focusPoint)
  }, [])

  // Update focus point with cone-shaped constraint (project onto cone surface)
  // Move along cone surface based on drag direction
  useFrame(() => {
    if (!controlsRef.current || !controlsRef.current.target || !mountainCenterPoint || !yRange) return

    const target = controlsRef.current.target
    
    // If dragging, move focus point along cone surface based on drag delta
    if (isDraggingRef.current && dragStartRef.current && currentMousePosRef.current) {
      const deltaX = currentMousePosRef.current.x - dragStartRef.current.x
      const deltaY = currentMousePosRef.current.y - dragStartRef.current.y
      
      // Calculate movement sensitivity based on screen size
      const screenHeight = window.innerHeight
      const screenWidth = window.innerWidth
      const sensitivity = 1.2 // Adjust for responsiveness
      
      // Vertical drag: move up/down the cone (change Y, which changes radius)
      // Pull up (negative deltaY) should move DOWN the cone (lower Y)
      // Pull down (positive deltaY) should move UP the cone (higher Y)
      const yRangeSize = yRange.max - yRange.min
      const yDelta = (-deltaY / screenHeight) * yRangeSize * sensitivity  // Negated for intuitive control
      
      // Find the lowest Y from the 6 cone bottom points (don't let red dot go below actual cone)
      const lowestConePointY = (mountainConeProfile && mountainConeProfile.bottomPointsByDirection && mountainConeProfile.bottomPointsByDirection.length > 0)
        ? Math.min(...mountainConeProfile.bottomPointsByDirection.map(p => p.y))
        : yRange.min
      
      // Clamp Y to valid range - use lowest cone point as minimum
      const newY = Math.max(lowestConePointY, Math.min(yRange.max, dragStartRef.current.targetY + yDelta))
      
      // Horizontal drag: rotate around the cone at current Y level
      // Positive deltaX (dragging right) should rotate clockwise (positive angle)
      const angleDelta = (deltaX / screenWidth) * Math.PI * 2 * sensitivity
      const newAngle = dragStartRef.current.targetAngle + angleDelta
      
      // Calculate radius at new Y position using mountain cone profile with smooth interpolation
      let newRadius: number
      if (mountainConeProfile) {
        // Use mountain-shaped cone profile with smooth interpolation between directions
        newRadius = getRadiusForAngleAndY(
          mountainConeProfile.radiusByDirection,
          newAngle,
          newY,
          yRange.min,
          yRange.max,
          10, // numSampleLevels
          6   // numDirections
        )
      } else {
        // Fallback to simple cone
        const yProgress = Math.max(0, Math.min(1, (yRange.max - newY) / (yRange.max - yRange.min)))
        newRadius = maxConeRadius * yProgress
      }
      
      // NO minimum radius constraint - let the red dot follow the true cone surface shape
      
      // Update target position directly on cone surface
      target.y = newY
      target.x = mountainCenterPoint.x + Math.cos(newAngle) * newRadius
      target.z = mountainCenterPoint.z + Math.sin(newAngle) * newRadius
      
      // Update camera position and angle based on focus point position on cone
      updateCameraPositionForCone(target, newY, yRange, mountainCenterPoint, camera)
      
      controlsRef.current.update()
    } else {
      // When not dragging, ensure point stays on cone surface
      let constrained: THREE.Vector3
      if (mountainConeProfile) {
        // Find the lowest Y from the 6 bottom points
        const lowestConePointY = mountainConeProfile.bottomPointsByDirection.length > 0
          ? Math.min(...mountainConeProfile.bottomPointsByDirection.map(p => p.y))
          : undefined
        
        // Use mountain-shaped cone constraint
        constrained = applyMountainConeConstraint(
          target,
          mountainCenterPoint,
          yRange.max,
          yRange.min,
          mountainConeProfile.radiusByDirection,
          10, // numSampleLevels
          lowestConePointY,
          mountainConeProfile.maxRadius
        )
      } else {
        // Fallback to simple cone constraint
        constrained = applyConeConstraint(
          target,
          mountainCenterPoint,
          yRange.max,
          yRange.min,
          maxConeRadius
        )
      }
      
      target.x = constrained.x
      target.y = constrained.y
      target.z = constrained.z
      
      // Update camera position based on current target position
      updateCameraPositionForCone(target, target.y, yRange, mountainCenterPoint, camera)
    }

    // DISABLED: Focus mode logic that was causing red dot to snap to trails
    // The cone constraint is now the only constraint - red dot moves freely on cone surface
    // No automatic snapping to mountain center or trails
    
    // if (focusMode === 'mountain-center' && !isTransitioning) {
    //   // Smoothly transition Y to mountain center (but keep on cone surface)
    //   const desiredY = THREE.MathUtils.lerp(target.y, mountainCenterPoint.y, 0.05)
    //   const tempPoint = new THREE.Vector3(target.x, desiredY, target.z)
    //   let projected: THREE.Vector3
    //   if (mountainConeProfile) {
    //     projected = applyMountainConeConstraint(tempPoint, mountainCenterPoint, yRange.max, yRange.min, mountainConeProfile.radiusByDirection, 10)
    //   } else {
    //     projected = applyConeConstraint(tempPoint, mountainCenterPoint, yRange.max, yRange.min, maxConeRadius)
    //   }
    //   target.x = projected.x
    //   target.y = projected.y
    //   target.z = projected.z
    // } else if (focusMode === 'trail-focused' && !isTransitioning) {
    //   // Try to focus on nearest trail (Y-axis only)
    //   const nearestTrail = findNearestTrailToScreenCenter(
    //     camera as THREE.PerspectiveCamera,
    //     skiFeatures,
    //     center,
    //     elevationScale,
    //     { x: 0.5, y: 0.5 }
    //   )
    //   
    //   if (nearestTrail) {
    //     const trailCenter = calculateTrailCenterPoint(nearestTrail, center, elevationScale)
    //     if (trailCenter) {
    //       // Smoothly transition Y to trail center Y (but keep on cone surface)
    //       const desiredY = THREE.MathUtils.lerp(target.y, trailCenter.y, 0.05)
    //       const tempPoint = new THREE.Vector3(target.x, desiredY, target.z)
    //       let projected: THREE.Vector3
    //       if (mountainConeProfile) {
    //         projected = applyMountainConeConstraint(tempPoint, mountainCenterPoint, yRange.max, yRange.min, mountainConeProfile.radiusByDirection, 10)
    //       } else {
    //         projected = applyConeConstraint(tempPoint, mountainCenterPoint, yRange.max, yRange.min, maxConeRadius)
    //       }
    //       target.x = projected.x
    //       target.y = projected.y
    //       target.z = projected.z
    //     }
    //   }
    // }
    // Red dot now moves freely on cone surface without snapping to trails or mountain center

    controlsRef.current.update()
    // Note: Red dot position is updated directly in the FocusPointIndicators component
  })

  // Expose cone parameters for visualization
  const coneParams = useMemo(() => ({
    centerPoint: mountainCenterPoint,
    maxY: yRange?.max ?? 0,
    minY: yRange?.min ?? 0,
    maxRadius: maxConeRadius
  }), [mountainCenterPoint, yRange, maxConeRadius])

  // Visual indicators for focus point and highest point (for testing/debugging)
  const redDotRef = useRef<THREE.Group>(null)
  const upLineRef = useRef<THREE.Line>(null)
  const lineToHighestRef = useRef<THREE.Line>(null)

  // Update red dot position in useFrame (no React re-renders)
  useFrame(() => {
    if (!controlsRef.current || !redDotRef.current) return
    const target = controlsRef.current.target
    
    // Update red dot position directly in Three.js
    redDotRef.current.position.set(target.x, target.y, target.z)
    
    // Update line to highest point
    if (lineToHighestRef.current && highestPoint) {
      const positions = lineToHighestRef.current.geometry.attributes.position as THREE.BufferAttribute
      positions.setXYZ(0, target.x, target.y, target.z)
      positions.setXYZ(1, highestPoint.x, highestPoint.y, highestPoint.z)
      positions.needsUpdate = true
    }
  })

  if (!highestPoint) return null

  // Create yellow line pointing up
  const upLineGeometry = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, 50, 0)
  ])
  
  // Create line to highest point  
  const lineToHighestGeometry = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(highestPoint.x, highestPoint.y, highestPoint.z)
  ])

  return (
    <>
      {/* Red sphere at current focus point (where camera is orbiting around) */}
      <group ref={redDotRef}>
        <mesh>
          <sphereGeometry args={[20, 16, 16]} />
          <meshBasicMaterial color="#ff0000" transparent opacity={0.8} />
        </mesh>
        {/* Yellow line pointing up */}
        <primitive 
          ref={upLineRef}
          object={new THREE.Line(upLineGeometry, new THREE.LineBasicMaterial({ color: '#ffff00' }))} 
        />
      </group>
      
      {/* Blue sphere at highest point (for reference) */}
      <group position={[highestPoint.x, highestPoint.y, highestPoint.z]}>
        <mesh>
          <sphereGeometry args={[15, 16, 16]} />
          <meshBasicMaterial color="#0000ff" transparent opacity={0.6} />
        </mesh>
      </group>
      
      {/* Line connecting current focus point to highest point */}
      <primitive 
        ref={lineToHighestRef}
        object={new THREE.Line(lineToHighestGeometry, new THREE.LineBasicMaterial({ color: '#00ff00' }))} 
      />
    </>
  )
}

// Visual Focus Plane Indicator - shows where the focus distance is
// REMOVED: FocusPlaneIndicator and DepthOfFieldController - unused features

// Alpha Shape Terrain Mesh - Creates a frosted glass backdrop that follows run layout
// Uses Delaunay triangulation + alpha shape filtering for clean boundaries
function SimpleTerrainMesh({
  skiFeatures,
  center,
  elevationScale,
  bounds,
  elevationOffset = 0,
  show = true,
  opacity = 0.9, // Mostly opaque for clean look
  wireframe = false,
  color = '#f0f4f8', // Clean cool white
  thickness = 0,
  extendEdges = 0,
  onGeometryReady
}: {
  skiFeatures: SkiFeature[]
  center: [number, number]
  elevationScale: number
  bounds: { minLat: number; maxLat: number; minLng: number; maxLng: number }
  elevationOffset?: number
  show?: boolean
  opacity?: number
  wireframe?: boolean
  color?: string
  thickness?: number
  extendEdges?: number
  onGeometryReady?: (geometry: THREE.BufferGeometry) => void
}) {
  const [terrainGeometry, setTerrainGeometry] = useState<THREE.BufferGeometry | null>(null)
  // Use opacity directly - ensure it defaults to 0.85 if undefined
  const finalOpacityValue = opacity ?? 0.85

  useEffect(() => {
    console.log('SimpleTerrainMesh useEffect triggered', { 
      skiFeatureCount: skiFeatures.length, 
      center, 
      elevationScale 
    })
    
    try {
      // Collect run coordinate points from trail features
      const runPoints: Array<{ x: number; z: number; y: number; runIndex: number; pointIndex: number }> = []
      const runPointArrays: Array<Array<{ x: number; z: number; y: number }>> = []

      skiFeatures.forEach((feature, featureIndex) => {
        if (feature.type !== 'trail') return
        
        const coords = extractCoordsFromFeature(feature)
        if (coords.length === 0) return

        const hasElevation = coordsHaveElevation(coords)
        const fallbackElevation = hasElevation ? null : getFallbackElevation(feature)

        const runPointsForThisRun: Array<{ x: number; z: number; y: number }> = []

        coords.forEach((coord: number[], pointIndex: number) => {
          if (!coord || coord.length < 2) return

          const lng = coord[0]
          const lat = coord[1]
          if (isNaN(lng) || isNaN(lat) || !isFinite(lng) || !isFinite(lat)) return

          const elevation = getElevationForCoord(coord, fallbackElevation)

          const [x, y, z] = geoJsonToSimpleSceneCoords([lng, lat, elevation], center, elevationScale)
          
          if (isNaN(x) || isNaN(y) || isNaN(z) || !isFinite(x) || !isFinite(y) || !isFinite(z)) return

          // Terrain elevation = run center elevation - offset (simplified)
          const terrainY = y - elevationOffset
          
          const point = { x, y: terrainY, z }
          runPoints.push({ ...point, runIndex: featureIndex, pointIndex })
          runPointsForThisRun.push(point)
        })

      if (runPointsForThisRun.length > 0) {
        runPointArrays.push(runPointsForThisRun)
      }
    })

    if (runPoints.length === 0) {
      console.warn('SimpleTerrainMesh: No run points collected from', skiFeatures.filter(f => f.type === 'trail').length, 'trail features')
      return
    }
    
    console.log('SimpleTerrainMesh: Collected', runPoints.length, 'run points from', runPointArrays.length, 'trails')

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
      
      // ========================================================================
      // ALPHA SHAPE FILTERING
      // Filter triangles by circumradius to remove stretched triangles
      // that span large gaps between runs
      // ========================================================================
      
      const indices: number[] = []
      const pointCount = uniquePoints.length
      
      // First pass: calculate average edge length for auto-tuning alpha
      let totalEdgeLength = 0
      let edgeCount = 0
      
      for (let i = 0; i < delaunay.triangles.length; i += 3) {
        const i0 = delaunay.triangles[i]
        const i1 = delaunay.triangles[i + 1]
        const i2 = delaunay.triangles[i + 2]
        
        if (i0 >= pointCount || i1 >= pointCount || i2 >= pointCount) continue
        
        const p0 = uniquePoints[i0]
        const p1 = uniquePoints[i1]
        const p2 = uniquePoints[i2]
        
        totalEdgeLength += Math.sqrt((p1.x - p0.x) ** 2 + (p1.z - p0.z) ** 2)
        totalEdgeLength += Math.sqrt((p2.x - p1.x) ** 2 + (p2.z - p1.z) ** 2)
        totalEdgeLength += Math.sqrt((p0.x - p2.x) ** 2 + (p0.z - p2.z) ** 2)
        edgeCount += 3
      }
      
      const avgEdgeLength = edgeCount > 0 ? totalEdgeLength / edgeCount : 500
      // Alpha multiplier: higher = more permissive (fills gaps), lower = tighter fit
      // Using 12x for a good balance between filling gaps and removing stretched triangles
      const alphaThreshold = avgEdgeLength * 12
      
      // Second pass: extract triangles with alpha shape filtering
      let alphaFilteredCount = 0
      let totalValidCount = 0
      
      for (let i = 0; i < delaunay.triangles.length; i += 3) {
        const i0 = delaunay.triangles[i]
        const i1 = delaunay.triangles[i + 1]
        const i2 = delaunay.triangles[i + 2]
        
        // Basic validation
        if (i0 === undefined || i1 === undefined || i2 === undefined ||
            i0 < 0 || i0 >= pointCount ||
            i1 < 0 || i1 >= pointCount ||
            i2 < 0 || i2 >= pointCount ||
            i0 === i1 || i1 === i2 || i0 === i2) {
          continue
        }
        
        totalValidCount++
        
        // Alpha shape test: filter by circumradius
        const p0 = uniquePoints[i0]
        const p1 = uniquePoints[i1]
        const p2 = uniquePoints[i2]
        
        const circumradius = calculateCircumradius(p0, p1, p2)
        
        // Keep triangle if circumradius is within threshold
        if (circumradius <= alphaThreshold) {
          indices.push(i0, i1, i2)
          alphaFilteredCount++
        }
      }
      
      // If alpha shape removed more than 30% of triangles, it might be too aggressive
      // In that case, log a warning but keep the filtered result
      const retentionRate = totalValidCount > 0 ? alphaFilteredCount / totalValidCount : 0
      console.log(`Alpha shape: kept ${alphaFilteredCount}/${totalValidCount} triangles (${(retentionRate * 100).toFixed(1)}%), threshold: ${alphaThreshold.toFixed(0)}`)

      if (indices.length === 0) {
        console.warn('No valid triangles after alpha shape filtering')
        return
      }
      
      console.log(`Terrain mesh: ${uniquePoints.length} points, ${indices.length / 3} triangles`)

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
        
        // Compute normals for proper lighting with meshPhysicalMaterial
        geometry.computeVertexNormals()
        
        console.log('Setting terrain geometry:', {
          vertexCount: geometry.attributes.position?.count,
          hasIndex: !!geometry.index,
          indexCount: geometry.index?.count
        })
        
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
  }, [skiFeatures, center, elevationScale, bounds, elevationOffset, thickness, extendEdges, color])

  if (!show || !terrainGeometry) {
    console.log('SimpleTerrainMesh not rendering:', { show, hasGeometry: !!terrainGeometry })
    return null
  }

  const finalOpacity = Math.max(0.1, finalOpacityValue)

  // Clean, bright terrain material
  return (
    <mesh geometry={terrainGeometry} renderOrder={0}>
      {wireframe ? (
        <meshBasicMaterial
          color="#ff0000"
          wireframe={true}
          side={THREE.DoubleSide}
        />
      ) : (
        <meshStandardMaterial
          color={color}
          transparent={true}
          opacity={finalOpacity}
          roughness={0.4}
          metalness={0.1}
          emissive={color}
          emissiveIntensity={0.05}
          side={THREE.DoubleSide}
          depthWrite={true}
          depthTest={true}
        />
      )}
    </mesh>
  )
}

// Component to render imported mesh from OBJ file
function ImportedTerrainMesh({
  geometry,
  opacity = 1,
  wireframe = false,
  color = '#ffffff'
}: {
  geometry: THREE.BufferGeometry
  opacity?: number
  wireframe?: boolean
  color?: string
}) {
  const finalOpacity = Math.max(0.1, opacity)
  
  return (
    <mesh geometry={geometry} renderOrder={0}>
      {wireframe ? (
        <meshBasicMaterial
          color="#ff0000"
          wireframe={true}
          side={THREE.DoubleSide}
        />
      ) : (
        <meshStandardMaterial
          color={color}
          transparent={true}
          opacity={finalOpacity}
          roughness={0.4}
          metalness={0.1}
          emissive={color}
          emissiveIntensity={0.05}
          side={THREE.DoubleSide}
          depthWrite={true}
          depthTest={true}
        />
      )}
    </mesh>
  )
}

// Metadata format for QGIS heightmap export
interface HeightmapMetadata {
  minElevation: number // Minimum elevation in meters (for black pixels)
  maxElevation: number // Maximum elevation in meters (for white pixels)
  bounds?: { // Optional: if provided, use these bounds instead of ski feature bounds
    minLat: number
    maxLat: number
    minLng: number
    maxLng: number
  }
  crs?: string // Coordinate reference system (e.g., "EPSG:4326")
}

// Component to render heightmap-based terrain from DEM image
function HeightmapTerrainMesh({
  heightmapUrl,
  heightmapMetadata,
  center,
  elevationScale,
  bounds,
  elevationOffset = 0,
  displacementScale = 1000,
  baseElevation = 0, // Base elevation for heightmap (black pixels = this elevation) - overridden by metadata
  segments = 100,
  opacity = 1,
  wireframe = false,
  color = '#f0f4f8',
  skiFeatures = [],
  onGeometryReady,
  rotationDeg = 0, // New: rotate DEM around Y axis to fix orientation (0/90/180/270)
  flipX = false,   // New: mirror along X axis
  flipZ = false    // New: mirror along Z axis
}: {
  heightmapUrl: string | null
  heightmapMetadata?: HeightmapMetadata | null // Optional metadata from QGIS export
  center: [number, number]
  elevationScale: number
  bounds: { minLat: number; maxLat: number; minLng: number; maxLng: number }
  elevationOffset?: number
  displacementScale?: number // Scale factor for heightmap displacement (meters per 255 gray levels) - overridden by metadata
  baseElevation?: number // Base elevation for heightmap (black pixels = this elevation in meters) - overridden by metadata
  segments?: number // Number of segments for plane geometry (higher = more detail)
  opacity?: number
  wireframe?: boolean
  color?: string
  skiFeatures?: SkiFeature[] // For elevation comparison/debugging
  onGeometryReady?: (geometry: THREE.BufferGeometry) => void
  rotationDeg?: number
  flipX?: boolean
  flipZ?: boolean
}) {
  const [terrainGeometry, setTerrainGeometry] = useState<THREE.BufferGeometry | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!heightmapUrl) {
      setTerrainGeometry(null)
      return
    }

    setLoading(true)
    setError(null)

    // Use metadata if provided, otherwise use passed parameters
    const effectiveMinElevation = heightmapMetadata?.minElevation ?? baseElevation
    const effectiveMaxElevation = heightmapMetadata?.maxElevation ?? (baseElevation + displacementScale)
    
    // Use DEM bounds if available (from GeoTIFF metadata), otherwise fall back to feature bounds
    // This ensures the terrain is positioned where the DEM actually is, not where we assume it should be
    // However, if DEM bounds don't overlap well with features, we should use feature bounds instead
    const demBounds = heightmapMetadata?.bounds
    
    // Check if DEM bounds overlap with feature bounds
    let useDemBounds = false
    if (demBounds) {
      const latOverlap = Math.min(bounds.maxLat, demBounds.maxLat) - Math.max(bounds.minLat, demBounds.minLat)
      const lngOverlap = Math.min(bounds.maxLng, demBounds.maxLng) - Math.max(bounds.minLng, demBounds.minLng)
      const featureLatRange = bounds.maxLat - bounds.minLat
      const featureLngRange = bounds.maxLng - bounds.minLng
      const overlapPercent = (latOverlap > 0 && lngOverlap > 0) 
        ? ((latOverlap * lngOverlap) / (featureLatRange * featureLngRange)) * 100
        : 0
      
      // Use DEM bounds only if there's significant overlap (>30%)
      // But also check the spatial offset - if DEM center is too far from feature center, use feature bounds
      const [demCenterLat, demCenterLng] = [(demBounds.minLat + demBounds.maxLat) / 2, (demBounds.minLng + demBounds.maxLng) / 2]
      const [demCenterMercX, demCenterMercY] = latLngToWebMercator(demCenterLat, demCenterLng)
      const [featureCenterMercX, featureCenterMercY] = latLngToWebMercator(center[0], center[1])
      const spatialOffsetMeters = Math.sqrt(
        Math.pow(demCenterMercX - featureCenterMercX, 2) + 
        Math.pow(demCenterMercY - featureCenterMercY, 2)
      )
      
      // Use DEM bounds only if overlap is good AND spatial offset is reasonable (<2km)
      useDemBounds = overlapPercent > 30 && spatialOffsetMeters < 2000
      
      if (!useDemBounds && demBounds) {
        console.warn('⚠️ DEM bounds have low overlap or large spatial offset - using feature bounds for alignment', {
          overlapPercent: overlapPercent.toFixed(1) + '%',
          spatialOffsetMeters: (spatialOffsetMeters / 1000).toFixed(2) + 'km',
          suggestion: 'Export a DEM from QGIS that covers the same area as your ski features'
        })
      }
    }
    
    const effectiveBounds = useDemBounds && demBounds ? {
      minLat: demBounds.minLat,
      maxLat: demBounds.maxLat,
      minLng: demBounds.minLng,
      maxLng: demBounds.maxLng
    } : bounds
    
    // Use DEM center if using DEM bounds, otherwise use feature center
    const demCenter: [number, number] = useDemBounds && demBounds ? [
      (demBounds.minLat + demBounds.maxLat) / 2,
      (demBounds.minLng + demBounds.maxLng) / 2
    ] : center
    const effectiveCenter = demCenter
    
    // Calculate elevation range from metadata
    const elevationRange = effectiveMaxElevation - effectiveMinElevation

    // Calculate sample feature elevations for comparison
    let sampleFeatureElevations: number[] = []
    if (skiFeatures.length > 0) {
      for (const feature of skiFeatures.slice(0, 10)) { // Sample first 10 features
        const coords = extractCoordsFromFeature(feature)
        if (coords.length > 0) {
          const hasElevation = coordsHaveElevation(coords)
          const fallbackElevation = hasElevation ? null : getFallbackElevation(feature)
          for (const coord of coords.slice(0, 5)) { // Sample first 5 coords per feature
            const elevation = getElevationForCoord(coord, fallbackElevation)
            if (elevation !== null && !isNaN(elevation)) {
              sampleFeatureElevations.push(elevation)
            }
          }
        }
      }
    }
    
    const minFeatureElevation = sampleFeatureElevations.length > 0 
      ? Math.min(...sampleFeatureElevations) 
      : null
    const maxFeatureElevation = sampleFeatureElevations.length > 0 
      ? Math.max(...sampleFeatureElevations) 
      : null

    // Check if DEM bounds match feature bounds
    let boundsMismatch = null
    if (demBounds) {
      const latOverlap = Math.min(bounds.maxLat, demBounds.maxLat) - Math.max(bounds.minLat, demBounds.minLat)
      const lngOverlap = Math.min(bounds.maxLng, demBounds.maxLng) - Math.max(bounds.minLng, demBounds.minLng)
      const featureLatRange = bounds.maxLat - bounds.minLat
      const featureLngRange = bounds.maxLng - bounds.minLng
      const overlapPercent = (latOverlap > 0 && lngOverlap > 0) 
        ? ((latOverlap * lngOverlap) / (featureLatRange * featureLngRange)) * 100
        : 0
      
      boundsMismatch = {
        overlapPercent: overlapPercent.toFixed(1) + '%',
        featureArea: `${featureLatRange.toFixed(4)}° × ${featureLngRange.toFixed(4)}°`,
        demArea: `${(demBounds.maxLat - demBounds.minLat).toFixed(4)}° × ${(demBounds.maxLng - demBounds.minLng).toFixed(4)}°`,
        warning: overlapPercent < 50 ? '⚠️ DEM and feature areas have little overlap - terrain may be misaligned!' : null
      }
    }

    console.log('Heightmap terrain setup:', {
      hasMetadata: !!heightmapMetadata,
      effectiveMinElevation,
      effectiveMaxElevation,
      elevationRange,
      featureBounds: bounds,
      featureCenter: center,
      demBounds: heightmapMetadata?.bounds,
      usingDemBounds: !!demBounds,
      effectiveBounds,
      effectiveCenter,
      boundsMismatch,
      elevationOffset,
      elevationScale,
      sampleFeatureElevations: sampleFeatureElevations.length > 0 
        ? { min: minFeatureElevation, max: maxFeatureElevation, count: sampleFeatureElevations.length }
        : 'no elevation data in features',
      elevationMatch: minFeatureElevation !== null && maxFeatureElevation !== null
        ? {
            demMin: effectiveMinElevation,
            demMax: effectiveMaxElevation,
            featureMin: minFeatureElevation,
            featureMax: maxFeatureElevation,
            demRange: elevationRange,
            featureRange: maxFeatureElevation - minFeatureElevation,
            offsetNeeded: minFeatureElevation - effectiveMinElevation
          }
        : null
    })
    
    if (boundsMismatch?.warning) {
      console.warn(boundsMismatch.warning, boundsMismatch)
    }

    // Load heightmap image
    const img = new Image()
    img.crossOrigin = 'anonymous'

    img.onload = () => {
      try {
        // Create canvas to read pixel data
        const canvas = document.createElement('canvas')
        canvas.width = img.width
        canvas.height = img.height
        const ctx = canvas.getContext('2d')
        
        if (!ctx) {
          throw new Error('Failed to get canvas context')
        }

        ctx.drawImage(img, 0, 0)
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
        const pixels = imageData.data

        // Calculate bounds in Web Mercator using effective bounds
        // Note: latLngToWebMercator(lat, lng) - lat first, then lng
        const [centerMercX, centerMercY] = latLngToWebMercator(effectiveCenter[0], effectiveCenter[1])
        const [minMercX, minMercY] = latLngToWebMercator(effectiveBounds.minLat, effectiveBounds.minLng)
        const [maxMercX, maxMercY] = latLngToWebMercator(effectiveBounds.maxLat, effectiveBounds.maxLng)

        // Calculate scene bounds (relative to center) - same as geoJsonToSimpleSceneCoords
        const sceneMinX = minMercX - centerMercX
        const sceneMaxX = maxMercX - centerMercX
        const sceneMinZ = -(maxMercY - centerMercY) // Flip Y to Z (Three.js convention: Y is up)
        const sceneMaxZ = -(minMercY - centerMercY)

        const sceneWidth = sceneMaxX - sceneMinX
        const sceneDepth = sceneMaxZ - sceneMinZ

        // Calculate feature center in Mercator for comparison
        const [featureCenterMercX, featureCenterMercY] = latLngToWebMercator(center[0], center[1])
        const [featureMinMercX, featureMinMercY] = latLngToWebMercator(bounds.minLat, bounds.minLng)
        const [featureMaxMercX, featureMaxMercY] = latLngToWebMercator(bounds.maxLat, bounds.maxLng)
        
        const offsetX = centerMercX - featureCenterMercX
        const offsetY = centerMercY - featureCenterMercY
        const offsetMeters = Math.sqrt(offsetX * offsetX + offsetY * offsetY)
        
        console.log('Heightmap terrain bounds:', {
          usingDemBounds: !!demBounds,
          featureBounds: bounds,
          demBounds: demBounds || 'using feature bounds',
          latRange: effectiveBounds.maxLat - effectiveBounds.minLat,
          lngRange: effectiveBounds.maxLng - effectiveBounds.minLng,
          sceneWidth,
          sceneDepth,
          centerMerc: [centerMercX, centerMercY],
          featureCenterMerc: [featureCenterMercX, featureCenterMercY],
          spatialOffset: {
            meters: offsetMeters.toFixed(2),
            x: offsetX.toFixed(2),
            y: offsetY.toFixed(2),
            warning: offsetMeters > 1000 ? `⚠️ DEM center is ${(offsetMeters / 1000).toFixed(1)}km away from feature center!` : 'OK'
          },
          boundsMerc: {
            min: [minMercX, minMercY],
            max: [maxMercX, maxMercY]
          }
        })
        
        if (offsetMeters > 1000) {
          console.warn('⚠️ DEM spatial mismatch detected!', {
            offsetMeters: offsetMeters.toFixed(2),
            suggestion: 'The DEM may not cover the same area as your features. Consider exporting a DEM from QGIS that covers the same geographic bounds as your ski features.'
          })
        }

        // Create plane geometry
        // PlaneGeometry creates a plane centered at (0,0,0) extending from -width/2 to width/2 in X
        // and -height/2 to height/2 in Y, with Z=0
        const geometry = new THREE.PlaneGeometry(sceneWidth, sceneDepth, segments, segments)
        const positions = geometry.attributes.position.array as Float32Array
        const vertexCount = positions.length / 3

        // Store elevations for each vertex - we'll apply them after rotation
        const vertexElevations = new Float32Array(vertexCount)

        // Displace vertices based on heightmap
        // PlaneGeometry creates plane in XY plane: X=width (-width/2 to width/2), Y=depth (-depth/2 to depth/2), Z=0
        // After rotation -90° around X axis: X stays X, Y becomes Z (depth), Z becomes -Y (elevation)
        for (let i = 0; i < vertexCount; i++) {
          const x = positions[i * 3]     // X position in plane: -width/2 to width/2 (stays X after rotation)
          const y = positions[i * 3 + 1] // Y position in plane: -depth/2 to depth/2 (becomes Z after rotation)

          // Convert plane vertex position to geographic coordinates (lat/lng)
          // CRITICAL: Always use DEM bounds for pixel sampling (if available), regardless of which bounds we used for plane positioning
          // This ensures pixels are sampled from where they actually are in the GeoTIFF, not where we assume they should be
          const normalizedX = (x + sceneWidth / 2) / sceneWidth // 0 to 1 in plane
          const normalizedY = (y + sceneDepth / 2) / sceneDepth // 0 to 1 in plane
          
          // Always use DEM bounds for pixel sampling if we have them
          // The DEM image was created from GeoTIFF with these bounds, so pixels MUST map to these bounds
          const pixelSamplingBounds = heightmapMetadata?.bounds || effectiveBounds
          const pixelLngRange = pixelSamplingBounds.maxLng - pixelSamplingBounds.minLng
          const pixelLatRange = pixelSamplingBounds.maxLat - pixelSamplingBounds.minLat
          
          // Map plane vertex to geographic coordinates
          // Use effectiveBounds for terrain positioning (where the terrain plane is)
          const terrainLngRange = effectiveBounds.maxLng - effectiveBounds.minLng
          const terrainLatRange = effectiveBounds.maxLat - effectiveBounds.minLat
          const vertexLng = effectiveBounds.minLng + normalizedX * terrainLngRange
          const vertexLat = effectiveBounds.maxLat - normalizedY * terrainLatRange // Flip Y: plane Y=0 is top (maxLat)
          
          // Map geographic coordinates to pixel coordinates using DEM's actual bounds
          // This is the key: pixels in the GeoTIFF/image map to DEM bounds, not necessarily feature bounds
          const u = pixelLngRange > 0 ? (vertexLng - pixelSamplingBounds.minLng) / pixelLngRange : 0.5
          const v = pixelLatRange > 0 ? (pixelSamplingBounds.maxLat - vertexLat) / pixelLatRange : 0.5 // Image coords: top is 0 (maxLat)
          
          // Clamp to valid range
          const clampedU = Math.max(0, Math.min(1, u))
          const clampedV = Math.max(0, Math.min(1, v))

          // Sample heightmap at this UV coordinate
          const pixelX = Math.floor(clampedU * (canvas.width - 1))
          const pixelY = Math.floor(clampedV * (canvas.height - 1))
          const pixelIndex = (pixelY * canvas.width + pixelX) * 4

          // Get grayscale value (use red channel, or average RGB for better quality)
          const r = pixels[pixelIndex]
          const g = pixels[pixelIndex + 1]
          const b = pixels[pixelIndex + 2]
          const gray = (r + g + b) / 3

          // Convert grayscale (0-255) to elevation (meters)
          // Using metadata elevation range if available, otherwise use parameters
          // - Black (0) = effectiveMinElevation
          // - White (255) = effectiveMaxElevation
          const normalizedHeight = gray / 255 // 0-1
          const elevation = effectiveMinElevation + (normalizedHeight * elevationRange)

          // Transform elevation to scene Y coordinate
          // Match SimpleTerrainMesh exactly:
          //   1. geoJsonToSimpleSceneCoords: y = elevation * elevationScale
          //   2. SimpleTerrainMesh: terrainY = y - elevationOffset
          // So: terrainY = (elevation * elevationScale) - elevationOffset
          const sceneY = (elevation * elevationScale) - elevationOffset
          
          // Store elevation for this vertex - we'll apply it directly to Y after rotation
          vertexElevations[i] = sceneY
        }

        // Update geometry (before rotation)
        geometry.attributes.position.needsUpdate = true
        geometry.computeVertexNormals()

        // Rotate plane to be horizontal (XZ plane, Y up)
        // Rotate -90° around X axis: (x, y, z) -> (x, -z, y)
        // Before: PlaneGeometry in XY plane (x: -width/2 to width/2, y: -depth/2 to depth/2, z: 0)
        // After: Plane in XZ plane (x: -width/2 to width/2, z: -depth/2 to depth/2, y: 0)
        geometry.rotateX(-Math.PI / 2)
        
        // NOW apply elevation displacement directly to Y coordinates
        const positionsAfterRotation = geometry.attributes.position.array as Float32Array
        
        // Find min/max elevations for color mapping
        let minElevationValue = Infinity
        let maxElevationValue = -Infinity
        for (let i = 0; i < vertexCount; i++) {
          minElevationValue = Math.min(minElevationValue, vertexElevations[i])
          maxElevationValue = Math.max(maxElevationValue, vertexElevations[i])
        }
        const elevationRangeForColor = maxElevationValue - minElevationValue
        
        // Create vertex colors based on elevation (for better visualization)
        const colors = new Float32Array(vertexCount * 3)
        
        for (let i = 0; i < vertexCount; i++) {
          // Y is at index 1 after rotation - set it directly to the calculated elevation
          positionsAfterRotation[i * 3 + 1] = vertexElevations[i]
          
          // Create color gradient: lower = darker blue/green, higher = lighter/white
          const normalizedElevation = elevationRangeForColor > 0 
            ? (vertexElevations[i] - minElevationValue) / elevationRangeForColor 
            : 0.5
          
          // Color gradient: dark green/blue (low) -> light green -> white (high)
          const r = 0.3 + normalizedElevation * 0.7 // 0.3 to 1.0
          const g = 0.5 + normalizedElevation * 0.5 // 0.5 to 1.0
          const b = 0.7 + normalizedElevation * 0.3 // 0.7 to 1.0
          
          colors[i * 3] = r
          colors[i * 3 + 1] = g
          colors[i * 3 + 2] = b
        }
        
        // Add color attribute to geometry
        geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
        
        geometry.attributes.position.needsUpdate = true
        geometry.computeVertexNormals()

        // Apply user-controlled orientation adjustments
        const rotationRad = (rotationDeg % 360) * Math.PI / 180
        if (rotationRad !== 0) {
          geometry.rotateY(rotationRad)
        }
        if (flipX) {
          geometry.scale(-1, 1, 1)
        }
        if (flipZ) {
          geometry.scale(1, 1, -1)
        }
        if (rotationRad !== 0 || flipX || flipZ) {
          geometry.computeVertexNormals()
          console.log('Applied DEM orientation:', { rotationDeg, flipX, flipZ })
        }

        // Position plane at scene center to match feature coordinates
        // After rotation: X stays X, Y becomes -Z, Z becomes Y
        // We need to translate so that:
        // - X maps to scene X coordinates (sceneMinX to sceneMaxX)
        // - Z maps to scene Z coordinates (sceneMinZ to sceneMaxZ)
        // - Y is elevation (already set by displacement, preserved by translate)
        // Center of plane is at (0, 0, 0) after rotation, so translate to scene center
        const centerX = (sceneMinX + sceneMaxX) / 2
        const centerZ = (sceneMinZ + sceneMaxZ) / 2
        // Translate only X and Z - Y is already set correctly by displacement
        geometry.translate(centerX, 0, centerZ)
        
        // Verify Y values after translation
        const positionsAfter = geometry.attributes.position.array as Float32Array
        let minYAfter = Infinity
        let maxYAfter = -Infinity
        for (let i = 0; i < vertexCount; i++) {
          const y = positionsAfter[i * 3 + 1] // Y is at index 1 after rotation
          minYAfter = Math.min(minYAfter, y)
          maxYAfter = Math.max(maxYAfter, y)
        }

        setTerrainGeometry(geometry)
        
        if (onGeometryReady) {
          onGeometryReady(geometry)
        }

        // Calculate terrain Y bounds for debugging
        const minTerrainY = (effectiveMinElevation * elevationScale) - elevationOffset
        const maxTerrainY = (effectiveMaxElevation * elevationScale) - elevationOffset
        
        // Log detailed elevation information
        console.log('=== HEIGHTMAP TERRAIN ELEVATION DEBUG ===')
        console.log('Elevation metadata:', {
          minElevation: effectiveMinElevation,
          maxElevation: effectiveMaxElevation,
          elevationRange,
          elevationScale,
          elevationOffset,
          note: `elevationScale is ${elevationScale < 1 ? 'SMALL (terrain will be flat)' : elevationScale > 3 ? 'LARGE (terrain will be exaggerated)' : 'NORMAL'}`
        })
        console.log('Calculated terrain Y range:', {
          min: minTerrainY,
          max: maxTerrainY,
          range: maxTerrainY - minTerrainY,
          formula: `(elevation * ${elevationScale}) - ${elevationOffset}`
        })
        console.log('Y values after rotation and elevation application:', {
          min: minElevationValue,
          max: maxElevationValue,
          range: elevationRangeForColor
        })
        console.log('Y values after translation:', {
          min: minYAfter,
          max: maxYAfter,
          range: maxYAfter - minYAfter
        })
        console.log('Example calculations:', {
          minElevation_sceneY: `${effectiveMinElevation} * ${elevationScale} - ${elevationOffset} = ${minTerrainY}`,
          maxElevation_sceneY: `${effectiveMaxElevation} * ${elevationScale} - ${elevationOffset} = ${maxTerrainY}`
        })
        if (Math.abs(minYAfter) < 10 && Math.abs(maxYAfter) < 10) {
          console.error('❌ PROBLEM: Terrain Y values are at sea level!', {
            minY: minYAfter,
            maxY: maxYAfter,
            elevationScale,
            elevationOffset,
            calculatedMinY: minTerrainY,
            calculatedMaxY: maxTerrainY,
            suggestion: elevationScale < 0.1 
              ? 'elevationScale is VERY SMALL - terrain will appear flat. Check bounds calculation.'
              : elevationOffset > effectiveMinElevation * elevationScale
              ? 'elevationOffset is too large and canceling out elevation. Reduce elevationOffset.'
              : 'Check if geometry transformations are preserving Y values correctly.'
          })
        } else {
          console.log('✅ Terrain Y values look reasonable (not at sea level)', {
            minY: minYAfter,
            maxY: maxYAfter
          })
        }
        console.log('==========================================')
      } catch (err) {
        console.error('Error creating heightmap terrain:', err)
        setError(err instanceof Error ? err.message : 'Failed to create terrain')
        setTerrainGeometry(null)
      } finally {
        setLoading(false)
      }
    }

    img.onerror = () => {
      setError('Failed to load heightmap image')
      setLoading(false)
      setTerrainGeometry(null)
    }

    img.src = heightmapUrl
  }, [heightmapUrl, center, elevationScale, bounds, elevationOffset, displacementScale, segments, onGeometryReady])

  if (!heightmapUrl || loading) {
    return null
  }

  if (error || !terrainGeometry) {
    return null
  }

  const finalOpacity = Math.max(0.1, opacity)

  // Create a material that shows elevation changes better
  // Use vertex colors if available, otherwise use base color
  const hasVertexColors = terrainGeometry?.attributes.color !== undefined
  
  const material = wireframe ? (
    <meshBasicMaterial
      color="#ff0000"
      wireframe={true}
      side={THREE.DoubleSide}
    />
  ) : (
    <meshStandardMaterial
      color={hasVertexColors ? '#ffffff' : color} // White base when using vertex colors
      transparent={true}
      opacity={finalOpacity}
      roughness={0.7} // Increased for better detail visibility
      metalness={0.0} // Reduced for better lighting contrast
      emissive={hasVertexColors ? '#000000' : color}
      emissiveIntensity={hasVertexColors ? 0 : 0.15} // No emissive when using vertex colors
      side={THREE.DoubleSide}
      depthWrite={true}
      depthTest={true}
      flatShading={false} // Smooth shading to show elevation changes
      vertexColors={hasVertexColors} // Enable vertex colors for elevation visualization
    />
  )

  return (
    <mesh geometry={terrainGeometry} renderOrder={0}>
      {material}
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

// Component to visualize the cone constraint grid (for development/debugging)
function ConeVisualization({
  centerPoint,
  maxY,
  minY,
  maxRadius,
  mountainConeProfile,
  show = true
}: {
  centerPoint: THREE.Vector3 | null
  maxY: number
  minY: number
  maxRadius: number
  mountainConeProfile?: {
    radiusByDirection: Map<number, Map<number, number>>
    minRadius: number
    maxRadius: number
    highestPoint: THREE.Vector3 | null
    bottomPointsByDirection: THREE.Vector3[]
  }
  show?: boolean
}) {
  if (!show || !centerPoint) return null

  // If we don't have a mountain profile, don't render anything
  if (!mountainConeProfile?.highestPoint || !mountainConeProfile.bottomPointsByDirection?.length) {
    return null
  }

  const highestPoint = mountainConeProfile.highestPoint
  const bottomPoints = mountainConeProfile.bottomPointsByDirection

  // Simple visualization: just show 6 lines from top to bottom
  return (
    <group>
      {/* Draw 6 lines from highest point to each bottom point */}
      {bottomPoints.map((bottomPoint, idx) => {
        const points = [
          new THREE.Vector3(highestPoint.x, highestPoint.y, highestPoint.z),
          new THREE.Vector3(bottomPoint.x, bottomPoint.y, bottomPoint.z)
        ]
        const lineGeometry = new THREE.BufferGeometry().setFromPoints(points)
        
        return (
          <primitive key={`cone-line-${idx}`} object={new THREE.Line(lineGeometry, new THREE.LineBasicMaterial({ color: '#00ff00' }))} />
        )
      })}
      
      {/* Draw lines connecting bottom points to form the base circle */}
      {bottomPoints.map((bottomPoint, idx) => {
        const nextIdx = (idx + 1) % bottomPoints.length // Wrap around to close the circle
        const nextPoint = bottomPoints[nextIdx]
        
        const points = [
          new THREE.Vector3(bottomPoint.x, bottomPoint.y, bottomPoint.z),
          new THREE.Vector3(nextPoint.x, nextPoint.y, nextPoint.z)
        ]
        const lineGeometry = new THREE.BufferGeometry().setFromPoints(points)
        
        return (
          <primitive key={`base-line-${idx}`} object={new THREE.Line(lineGeometry, new THREE.LineBasicMaterial({ color: '#00ff00' }))} />
        )
      })}
      
      {/* Top point marker (cyan) */}
      <mesh position={[highestPoint.x, highestPoint.y, highestPoint.z]}>
        <sphereGeometry args={[30, 16, 16]} />
        <meshBasicMaterial color="#00ffff" transparent opacity={0.9} />
      </mesh>
      
      {/* Bottom points markers (green) */}
      {bottomPoints.map((bottomPoint, idx) => (
        <mesh key={`bottom-${idx}`} position={[bottomPoint.x, bottomPoint.y, bottomPoint.z]}>
          <sphereGeometry args={[20, 16, 16]} />
          <meshBasicMaterial color="#00ff00" transparent opacity={0.7} />
        </mesh>
      ))}
      
      {/* Center point marker (yellow) */}
      <mesh position={[centerPoint.x, centerPoint.y, centerPoint.z]}>
        <sphereGeometry args={[50, 16, 16]} />
        <meshBasicMaterial color="#ffff00" transparent opacity={0.8} />
      </mesh>
    </group>
  )
}

// Component to handle camera reset (needs to be inside Canvas for useThree access)
function ResetCameraHandler({ 
  onResetRequested, 
  trailBounds, 
  controlsRef 
}: { 
  onResetRequested: boolean
  trailBounds: THREE.Box3
  controlsRef: React.MutableRefObject<any>
}) {
  const { camera } = useThree()
  const resetRequestedRef = useRef(false)

  useEffect(() => {
    if (onResetRequested && !resetRequestedRef.current && !trailBounds.isEmpty() && 'fov' in camera) {
      resetRequestedRef.current = true
      const perspectiveCamera = camera as THREE.PerspectiveCamera
      
      // Calculate zoom-to-fit position
      const mountainCenter = new THREE.Vector3(0, 0, 0)
      const zoomToFit = calculateZoomToFitBounds(trailBounds, perspectiveCamera, mountainCenter)
      
      // Smoothly animate to reset position
      const startPos = camera.position.clone()
      const startTarget = controlsRef.current.target.clone()
      const duration = 1000 // 1 second
      const startTime = Date.now()
      
      const animate = () => {
        const elapsed = Date.now() - startTime
        const progress = Math.min(elapsed / duration, 1)
        const eased = easeInOutCubic(progress)
        
        camera.position.lerpVectors(startPos, zoomToFit.position, eased)
        controlsRef.current.target.lerpVectors(startTarget, zoomToFit.target, eased)
        controlsRef.current.update()
        
        if (progress < 1) {
          requestAnimationFrame(animate)
        } else {
          resetRequestedRef.current = false
        }
      }
      
      animate()
    }
  }, [onResetRequested, trailBounds, camera, controlsRef])

  return null
}

// Calculate highest point from ski features (uses shared utilities)
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

      for (const feature of skiFeatures) {
        const coords = extractCoordsFromFeature(feature)
        if (coords.length === 0) continue

        const hasElevation = coordsHaveElevation(coords)
        const fallbackElevation = hasElevation ? null : getFallbackElevation(feature)

        for (const coord of coords) {
          if (!coord || coord.length < 2) continue
          
          const lng = coord[0]
          const lat = coord[1]
          if (isNaN(lng) || isNaN(lat) || !isFinite(lng) || !isFinite(lat)) continue
          
          const elevation = getElevationForCoord(coord, fallbackElevation)
          
          try {
            const [x, y, z] = geoJsonToSimpleSceneCoords([lng, lat, elevation], center, elevationScale)
            if (isNaN(x) || isNaN(y) || isNaN(z) || !isFinite(x) || !isFinite(y) || !isFinite(z)) continue
            
            if (y > maxY) {
              maxY = y
              highestPointVec = new THREE.Vector3(x, y, z)
            }
          } catch {
            // Skip invalid coordinates
          }
        }
      }

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

      for (const feature of skiFeatures) {
        const coords = extractCoordsFromFeature(feature)
        if (coords.length === 0) continue

        const hasElevation = coordsHaveElevation(coords)
        const fallbackElevation = hasElevation ? null : getFallbackElevation(feature)

        for (const coord of coords) {
          if (!coord || coord.length < 2) continue
          
          const lng = coord[0]
          const lat = coord[1]
          if (isNaN(lng) || isNaN(lat) || !isFinite(lng) || !isFinite(lat)) continue
          
          const elevation = getElevationForCoord(coord, fallbackElevation)
          
          try {
            const [x, y, z] = geoJsonToSimpleSceneCoords([lng, lat, elevation], center, elevationScale)
            if (isNaN(x) || isNaN(y) || isNaN(z) || !isFinite(x) || !isFinite(y) || !isFinite(z)) continue
            
            if (y > maxY) {
              maxY = y
              highestPointVec = new THREE.Vector3(x, y, z)
            }
            
            if (y < minY) {
              minY = y
              lowestPointVec = new THREE.Vector3(x, y, z)
            }
          } catch {
            // Skip invalid coordinates
          }
        }
      }

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
export type TerrainMeshType = 'none' | 'delaunay' | 'heightmap'

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
  terrainColor = '#e8f0f8',
  terrainThickness = 0,
  terrainExtendEdges = 0,
  onTerrainGeometryReady,
  importedMeshGeometry = null,
  heightmapUrl = null,
  heightmapMetadata = null,
  heightmapDisplacementScale = 1000,
  heightmapBaseElevation = 0,
  heightmapSegments = 100,
  heightmapElevationOffset = 0,
  heightmapRotationDeg = 0,
  heightmapFlipX = false,
  heightmapFlipZ = false,
  userRunCompletions = []
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
  onTerrainGeometryReady?: (geometry: THREE.BufferGeometry) => void
  importedMeshGeometry?: THREE.BufferGeometry | null
  heightmapUrl?: string | null
  heightmapMetadata?: HeightmapMetadata | null
  heightmapDisplacementScale?: number
  heightmapBaseElevation?: number
  heightmapSegments?: number
  heightmapElevationOffset?: number
  heightmapRotationDeg?: number
  heightmapFlipX?: boolean
  heightmapFlipZ?: boolean
  userRunCompletions?: Array<{
    id: string
    gps_track?: { type: 'LineString'; coordinates: Array<[number, number] | [number, number, number]> } | null
    completed_at: string
    ski_feature_id?: string | null
    ski_feature?: { name?: string } | null
  }>
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

  // Convert user run completions to SkiFeature format for rendering
  const userRunFeatures: SkiFeature[] = useMemo(() => {
    console.log('Processing user run completions:', {
      total: userRunCompletions.length,
      withGpsTrack: userRunCompletions.filter(c => c.gps_track).length
    })

    const features = userRunCompletions
      .filter(completion => {
        // Check if GPS track exists and has valid coordinates
        if (!completion.gps_track) {
          console.warn('Run completion missing gps_track:', completion.id)
          return false
        }
        
        // Handle both GeoJSON format and raw coordinates array
        const coords = completion.gps_track.type === 'LineString' 
          ? completion.gps_track.coordinates 
          : (completion.gps_track as any).coordinates || []
        
        if (!Array.isArray(coords) || coords.length < 2) {
          console.warn('Run completion has invalid coordinates:', completion.id, { coords })
          return false
        }
        
        return true
      })
      .map((completion, index) => {
        // Extract coordinates - handle both GeoJSON format and raw format
        const gpsTrack = completion.gps_track as any
        const coords = gpsTrack.type === 'LineString' 
          ? gpsTrack.coordinates 
          : (gpsTrack.coordinates || [])
        
        const runName = completion.ski_feature?.name || `Run ${new Date(completion.completed_at).toLocaleTimeString()}`
        
        return {
          id: `user-run-${completion.id}`,
          resort_id: '', // Not needed for rendering
          name: runName,
          type: 'trail' as const,
          difficulty: null,
          geometry: {
            type: 'LineString',
            coordinates: coords
          } as GeoJSONLineString,
          metadata: null,
          status: null,
          active: true,
          order_index: null,
          created_at: completion.completed_at
        } as SkiFeature
      })
    
    console.log(`Converted ${features.length} user runs to SkiFeatures`)
    return features
  }, [userRunCompletions])

  return (
    <>
      {/* Render trails, lifts, and boundaries as lines */}
      {features.map((feature) => (
        <SimpleTrail3D
          key={`${feature.type}-${feature.id}`}
          feature={feature}
          center={center}
          elevationScale={elevationScale}
          isUserRun={false}
        />
      ))}
      
      {/* Render user runs as gold lines */}
      {userRunFeatures.map((feature) => (
        <SimpleTrail3D
          key={`user-run-${feature.id}`}
          feature={feature}
          center={center}
          elevationScale={elevationScale}
          isUserRun={true}
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
        />
      ) : terrainMeshType === 'heightmap' && heightmapUrl ? (
        <HeightmapTerrainMesh
          key="heightmap-mesh"
          heightmapUrl={heightmapUrl}
          heightmapMetadata={heightmapMetadata}
          center={center}
          elevationScale={elevationScale}
          bounds={bounds}
          elevationOffset={heightmapElevationOffset}
          displacementScale={heightmapDisplacementScale}
          baseElevation={heightmapBaseElevation}
          segments={heightmapSegments}
          opacity={terrainOpacity}
          wireframe={terrainWireframe}
          color={terrainColor}
          skiFeatures={skiFeatures}
          onGeometryReady={onTerrainGeometryReady}
          rotationDeg={heightmapRotationDeg}
          flipX={heightmapFlipX}
          flipZ={heightmapFlipZ}
        />
      ) : (
        terrainMeshType === 'delaunay' && (
          <SimpleTerrainMesh
            skiFeatures={skiFeatures}
            center={center}
            elevationScale={elevationScale}
            bounds={bounds}
            elevationOffset={terrainConfig?.elevationOffset || 0}
            show={true}
            opacity={terrainOpacity}
            wireframe={terrainWireframe}
            color={terrainColor}
            thickness={terrainThickness}
            extendEdges={terrainExtendEdges}
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
  terrainConfig,
  userRunCompletions = []
}: SimpleMap3DProps) {
  const controlsRef = useRef<any>(null)
  const [showAxes, setShowAxes] = useState(true)
  const [showConeGrid, setShowConeGrid] = useState(true) // Show cone grid by default for development
  const [coneParams, setConeParams] = useState<{ 
    centerPoint: THREE.Vector3 | null
    maxY: number
    minY: number
    maxRadius: number
    mountainConeProfile?: {
      radiusByDirection: Map<number, Map<number, number>>
      minRadius: number
      maxRadius: number
      highestPoint: THREE.Vector3 | null
      bottomPointsByDirection: THREE.Vector3[]
    }
  }>({
    centerPoint: null,
    maxY: 0,
    minY: 0,
    maxRadius: 0
  })
  const [terrainMeshType, setTerrainMeshType] = useState<TerrainMeshType>('delaunay') // Default to delaunay for visibility
  const [terrainOpacity, setTerrainOpacity] = useState(1) // Fully opaque white
  const [terrainWireframe, setTerrainWireframe] = useState(false)
  const [terrainColor, setTerrainColor] = useState('#f0f4f8') // Clean cool white
  const [terrainThickness, setTerrainThickness] = useState(0) // Thickness of terrain mesh
  const [terrainExtendEdges, setTerrainExtendEdges] = useState(0) // Distance to extend edges outward
  const terrainGeometryRef = useRef<THREE.BufferGeometry | null>(null)
  const [importedMeshGeometry, setImportedMeshGeometry] = useState<THREE.BufferGeometry | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [heightmapUrl, setHeightmapUrl] = useState<string | null>(null) // Heightmap image URL (data URL or file path)
  const [heightmapMetadata, setHeightmapMetadata] = useState<HeightmapMetadata | null>(null) // Metadata from QGIS export
  const [heightmapDisplacementScale, setHeightmapDisplacementScale] = useState(1000) // Displacement scale in meters
  const [heightmapBaseElevation, setHeightmapBaseElevation] = useState(0) // Base elevation for heightmap (black pixels)
  const [heightmapSegments, setHeightmapSegments] = useState(100) // Number of segments for heightmap plane
  const [heightmapElevationOffset, setHeightmapElevationOffset] = useState(0) // Vertical offset to adjust DEM up/down to match runs
  const [heightmapRotationDeg, setHeightmapRotationDeg] = useState(0) // Orientation controls
  const [heightmapFlipX, setHeightmapFlipX] = useState(false)
  const [heightmapFlipZ, setHeightmapFlipZ] = useState(false)
  const heightmapInputRef = useRef<HTMLInputElement>(null)
  const heightmapMetadataInputRef = useRef<HTMLInputElement>(null)
  
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
  
  // Function to load heightmap image from file (supports GeoTIFF and regular images)
  const loadHeightmapFromFile = async (file: File) => {
    const isGeoTIFF = file.name.toLowerCase().endsWith('.tif') || 
                     file.name.toLowerCase().endsWith('.tiff') ||
                     file.type === 'image/tiff' ||
                     file.type === 'image/tif'

    if (isGeoTIFF) {
      // Check file size - warn if very large
      const fileSizeMB = file.size / (1024 * 1024)
      const MAX_RECOMMENDED_SIZE_MB = 100 // 100MB
      
      if (fileSizeMB > MAX_RECOMMENDED_SIZE_MB) {
        const proceed = confirm(
          `GeoTIFF file is large (${fileSizeMB.toFixed(1)} MB). This may take a while to load and could cause performance issues.\n\n` +
          `Consider exporting a lower resolution version from QGIS (e.g., resample to 50-100m resolution).\n\n` +
          `Continue anyway?`
        )
        if (!proceed) return
      }

      // Load GeoTIFF and extract metadata
      try {
        console.log('Loading GeoTIFF, this may take a moment for large files...')
        const arrayBuffer = await file.arrayBuffer()
        const tiff = await fromArrayBuffer(arrayBuffer)
        const image = await tiff.getImage()
        
        // Get pixel dimensions
        const width = image.getWidth()
        const height = image.getHeight()
        const totalPixels = width * height
        
        // Check if image is too large - suggest downsampling
        const MAX_PIXELS = 50_000_000 // 50 million pixels (about 7000x7000)
        if (totalPixels > MAX_PIXELS) {
          const downsample = confirm(
            `GeoTIFF is very high resolution (${width}×${height} = ${(totalPixels / 1_000_000).toFixed(1)}M pixels).\n\n` +
            `This may cause memory issues. Would you like to downsample to a lower resolution?\n\n` +
            `(Recommended: Export a lower resolution version from QGIS instead)`
          )
          
          if (downsample) {
            // Calculate downsampling factor to get under MAX_PIXELS
            const downsampleFactor = Math.ceil(Math.sqrt(totalPixels / MAX_PIXELS))
            const newWidth = Math.floor(width / downsampleFactor)
            const newHeight = Math.floor(height / downsampleFactor)
            
            console.log(`Downsampling from ${width}×${height} to ${newWidth}×${newHeight} (factor: ${downsampleFactor})`)
            
            // Read full resolution first, then downsample
            const rasters = await image.readRasters({ 
              width: newWidth, 
              height: newHeight,
              resampleMethod: 'nearest' // or 'bilinear' for smoother
            })
            const elevationData = Array.from(rasters[0] as Float32Array)
            
            // Use downsampled dimensions for canvas
            const canvas = document.createElement('canvas')
            canvas.width = newWidth
            canvas.height = newHeight
            const ctx = canvas.getContext('2d')
            
            if (ctx) {
              // Get elevation stats from downsampled data (use loop to avoid stack overflow)
              let minElevation = Infinity
              let maxElevation = -Infinity
              let validCount = 0
              let noDataCount = 0
              
              // Get NoData value if available
              let noDataValue: number | null = null
              try {
                noDataValue = image.getGDALNoData() ?? null
              } catch (e) {
                // NoData value not available
              }
              
              for (let i = 0; i < elevationData.length; i++) {
                const v = elevationData[i]
                
                // Check for NaN or invalid values
                if (isNaN(v) || !isFinite(v)) {
                  noDataCount++
                  continue
                }
                
                // Check for NoData value
                if (noDataValue !== null && v === noDataValue) {
                  noDataCount++
                  continue
                }
                
                // Check for reasonable elevation range
                if (v < -1000 || v > 10000) {
                  noDataCount++
                  continue
                }
                
                minElevation = Math.min(minElevation, v)
                maxElevation = Math.max(maxElevation, v)
                validCount++
              }
              
              const downsampledElevationRange = maxElevation - minElevation
              
              console.log('GeoTIFF elevation statistics (downsampled):', {
                totalPixels: elevationData.length,
                validCount,
                noDataCount,
                minElevation: validCount > 0 ? minElevation.toFixed(2) : 'NO VALID DATA',
                maxElevation: validCount > 0 ? maxElevation.toFixed(2) : 'NO VALID DATA',
                elevationRange: validCount > 0 ? downsampledElevationRange.toFixed(2) : 'NO VALID DATA',
                warning: validCount === 0 
                  ? '⚠️ NO VALID ELEVATION DATA'
                  : downsampledElevationRange < 10
                  ? '⚠️ Very small elevation range (<10m)'
                  : 'OK'
              })
              
              if (validCount === 0) {
                minElevation = 0
                maxElevation = 1000
              } else if (downsampledElevationRange < 1) {
                alert(`⚠️ CRITICAL: Elevation range < 1m in downsampled GeoTIFF!\n\n` +
                      `Min: ${minElevation.toFixed(2)}m, Max: ${maxElevation.toFixed(2)}m\n\n` +
                      `The terrain will appear flat. Check your DEM data.`)
              }
              
              // Normalize and create image
              const elevationRange = downsampledElevationRange
              const imageData = ctx.createImageData(newWidth, newHeight)
              
              for (let i = 0; i < elevationData.length; i++) {
                const elevation = elevationData[i]
                const normalized = elevationRange > 0 
                  ? Math.max(0, Math.min(255, ((elevation - minElevation) / elevationRange) * 255))
                  : 128
                
                const pixelIndex = i * 4
                imageData.data[pixelIndex] = normalized
                imageData.data[pixelIndex + 1] = normalized
                imageData.data[pixelIndex + 2] = normalized
                imageData.data[pixelIndex + 3] = 255
              }
              
              ctx.putImageData(imageData, 0, 0)
              const dataUrl = canvas.toDataURL('image/png')
              setHeightmapUrl(dataUrl)
              
              // Get bounds
              const bbox = image.getBoundingBox()
              const geoKeys = image.getGeoKeys()
              let crs = 'EPSG:4326'
              if (geoKeys && geoKeys.GeographicTypeGeoKey) {
                const geoType = geoKeys.GeographicTypeGeoKey
                if (geoType === 4326) crs = 'EPSG:4326'
                else if (geoType === 4269) crs = 'EPSG:4269'
              }
              
              const bounds = {
                minLng: bbox[0],
                minLat: bbox[1],
                maxLng: bbox[2],
                maxLat: bbox[3]
              }
              
              const metadata: HeightmapMetadata = {
                minElevation: minElevation,
                maxElevation: maxElevation,
                bounds: bounds,
                crs: crs
              }
              
              setHeightmapMetadata(metadata)
              setHeightmapBaseElevation(minElevation)
              setHeightmapDisplacementScale(maxElevation - minElevation)
              
              if (terrainMeshType !== 'heightmap') {
                setTerrainMeshType('heightmap')
              }
              
              alert(`GeoTIFF loaded (downsampled to ${newWidth}×${newHeight})!\nMin: ${minElevation.toFixed(1)}m\nMax: ${maxElevation.toFixed(1)}m`)
              return
            }
          } else {
            // User chose not to downsample, but file is still large - try to load anyway
            console.warn('Loading large GeoTIFF without downsampling - may cause issues')
          }
        }
        
        // Get georeferencing information (width and height already declared above)
        const bbox = image.getBoundingBox() // [minX, minY, maxX, maxY] in CRS coordinates
        const geoKeys = image.getGeoKeys()
        
        // Read elevation data to get min/max
        let rasters
        try {
          rasters = await image.readRasters()
        } catch (error) {
          if (error instanceof Error && (error.message.includes('too large') || error.message.includes('memory'))) {
            alert(
              `GeoTIFF is too large to load in the browser (${width}×${height} pixels).\n\n` +
              `Please export a lower resolution version from QGIS:\n` +
              `1. Right-click DEM layer → Export → Save As\n` +
              `2. Set resolution to 50-100 meters\n` +
              `3. Or use Raster → Resample to reduce size`
            )
            return
          }
          throw error
        }
        const elevationData = Array.from(rasters[0] as Float32Array)
        
        // Filter out NoData values (typically very negative or NaN)
        // Use reduce to avoid stack overflow with large arrays
        let minElevation = Infinity
        let maxElevation = -Infinity
        let validCount = 0
        let noDataCount = 0
        let outOfRangeCount = 0
        
        // Get NoData value from GeoTIFF metadata if available (may be null)
        let noDataValue: number | null = null
        try {
          noDataValue = image.getGDALNoData() ?? null
        } catch (e) {
          // NoData value not available, that's ok - we'll rely on NaN checks
        }
        
        for (let i = 0; i < elevationData.length; i++) {
          const v = elevationData[i]
          
          // Check for NaN or invalid values first
          if (isNaN(v) || !isFinite(v)) {
            noDataCount++
            continue
          }
          
          // Check for NoData value (only if it's explicitly set and not null)
          if (noDataValue !== null && v === noDataValue) {
            noDataCount++
            continue
          }
          
          // Check for reasonable elevation range (meters above/below sea level)
          // Be more lenient - allow -1000 to 10000 for ski resorts (Death Valley is -86m, Everest is 8848m)
          if (v < -1000 || v > 10000) {
            outOfRangeCount++
            continue
          }
          
          minElevation = Math.min(minElevation, v)
          maxElevation = Math.max(maxElevation, v)
          validCount++
        }
        
        const elevationRange = maxElevation - minElevation
        
        console.log('GeoTIFF elevation statistics:', {
          totalPixels: elevationData.length,
          validCount,
          noDataCount,
          outOfRangeCount,
          minElevation: validCount > 0 ? minElevation : 'NO VALID DATA',
          maxElevation: validCount > 0 ? maxElevation : 'NO VALID DATA',
          elevationRange: validCount > 0 ? elevationRange : 'NO VALID DATA',
          noDataValue: noDataValue ?? 'not specified',
          sampleValues: elevationData.length > 0 
            ? Array.from(elevationData.slice(0, 10)).map(v => isNaN(v) ? 'NaN' : v.toFixed(2))
            : [],
          warning: validCount === 0 
            ? '⚠️ NO VALID ELEVATION DATA - terrain will be flat!'
            : elevationRange < 1
            ? '⚠️ Elevation range < 1m - terrain will be completely flat'
            : elevationRange < 10
            ? '⚠️ Very small elevation range (<10m) - terrain will appear almost flat'
            : elevationRange < 50
            ? '⚠️ Small elevation range (<50m) - terrain may appear somewhat flat'
            : 'OK - elevation range looks reasonable'
        })
        
        if (validCount === 0) {
          alert('⚠️ No valid elevation data found in GeoTIFF!\n\n' +
                `Total pixels: ${elevationData.length}\n` +
                `NoData values: ${noDataCount}\n` +
                `Out of range: ${outOfRangeCount}\n\n` +
                'The file may not contain elevation data, or all values are marked as NoData.\n\n' +
                'Please check that your DEM file contains valid elevation values.\n\n' +
                'Check the console for detailed statistics.')
          minElevation = 0
          maxElevation = 1000
        } else if (elevationRange < 1) {
          alert(`⚠️ CRITICAL: Elevation range is < 1 meter (${elevationRange.toFixed(3)}m)\n\n` +
                `Min: ${minElevation.toFixed(2)}m, Max: ${maxElevation.toFixed(2)}m\n\n` +
                `The terrain will appear completely flat. This suggests the DEM may not contain actual elevation data.\n\n` +
                `Valid pixels: ${validCount}/${elevationData.length}`)
        } else if (elevationRange < 10) {
          alert(`⚠️ Warning: Very small elevation range detected (${elevationRange.toFixed(1)}m)\n\n` +
                `Min: ${minElevation.toFixed(1)}m, Max: ${maxElevation.toFixed(1)}m\n\n` +
                `The terrain will appear almost flat. Make sure your DEM contains actual elevation data.`)
        }
        
        // Determine CRS - check GeoKeys for coordinate system
        let crs = 'EPSG:4326' // Default to WGS84
        if (geoKeys && geoKeys.GeographicTypeGeoKey) {
          // Try to determine CRS from GeoKeys
          const geoType = geoKeys.GeographicTypeGeoKey
          if (geoType === 4326) crs = 'EPSG:4326'
          else if (geoType === 4269) crs = 'EPSG:4269' // NAD83
        }
        
        // Convert bbox to lat/lng if needed (assuming bbox is in the CRS)
        // For now, assume bbox is [minLng, minLat, maxLng, maxLat] for EPSG:4326
        // If it's in a different CRS, we'd need to transform it
        const bounds = {
          minLng: bbox[0],
          minLat: bbox[1],
          maxLng: bbox[2],
          maxLat: bbox[3]
        }
        
        // Create metadata from GeoTIFF
        const metadata: HeightmapMetadata = {
          minElevation: minElevation,
          maxElevation: maxElevation,
          bounds: bounds,
          crs: crs
        }
        
        setHeightmapMetadata(metadata)
        
        // Convert GeoTIFF to image for display
        // Create a canvas to render the GeoTIFF as an image
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext('2d')
        
        if (ctx) {
          // Normalize elevation data to 0-255 for grayscale image
          const elevationRange = maxElevation - minElevation
          const imageData = ctx.createImageData(width, height)
          
          for (let i = 0; i < elevationData.length; i++) {
            const elevation = elevationData[i]
            const normalized = elevationRange > 0 
              ? Math.max(0, Math.min(255, ((elevation - minElevation) / elevationRange) * 255))
              : 128
            
            const pixelIndex = i * 4
            imageData.data[pixelIndex] = normalized     // R
            imageData.data[pixelIndex + 1] = normalized // G
            imageData.data[pixelIndex + 2] = normalized // B
            imageData.data[pixelIndex + 3] = 255        // A
          }
          
          ctx.putImageData(imageData, 0, 0)
          const dataUrl = canvas.toDataURL('image/png')
          setHeightmapUrl(dataUrl)
        } else {
          // Fallback: use arrayBuffer as data URL (won't work well, but better than nothing)
          const blob = new Blob([arrayBuffer], { type: 'image/tiff' })
          const dataUrl = URL.createObjectURL(blob)
          setHeightmapUrl(dataUrl)
        }
        
        // Auto-update base elevation and displacement scale from metadata
        setHeightmapBaseElevation(minElevation)
        setHeightmapDisplacementScale(maxElevation - minElevation)
        
        // Automatically switch to heightmap mode
        if (terrainMeshType !== 'heightmap') {
          setTerrainMeshType('heightmap')
        }
        
        console.log('GeoTIFF loaded:', {
          fileName: file.name,
          size: file.size,
          width,
          height,
          metadata,
          elevationRange: maxElevation - minElevation
        })
        
        alert(`GeoTIFF loaded successfully!\nMin elevation: ${minElevation.toFixed(1)}m\nMax elevation: ${maxElevation.toFixed(1)}m\nBounds: ${bounds.minLat.toFixed(4)}, ${bounds.minLng.toFixed(4)} to ${bounds.maxLat.toFixed(4)}, ${bounds.maxLng.toFixed(4)}`)
      } catch (error) {
        console.error('Error loading GeoTIFF:', error)
        alert(`Failed to load GeoTIFF: ${error instanceof Error ? error.message : 'Unknown error'}\n\nMake sure the file is a valid GeoTIFF exported from QGIS.`)
      }
    } else {
      // Regular image file (PNG, JPG, etc.)
      if (!file.type.startsWith('image/')) {
        alert('Please select an image file (PNG, JPG, GeoTIFF, etc.)')
        return
      }

      const reader = new FileReader()
      reader.onload = (e) => {
        const dataUrl = e.target?.result as string
        if (dataUrl) {
          setHeightmapUrl(dataUrl)
          // Automatically switch to heightmap mode
          if (terrainMeshType !== 'heightmap') {
            setTerrainMeshType('heightmap')
          }
          console.log('Heightmap loaded:', { fileName: file.name, size: file.size })
        }
      }
      reader.onerror = () => {
        alert('Failed to load heightmap image')
      }
      reader.readAsDataURL(file)
    }
  }

  // Function to load heightmap metadata JSON from QGIS export
  const loadHeightmapMetadata = (file: File) => {
    if (file.type !== 'application/json' && !file.name.endsWith('.json')) {
      alert('Please select a JSON metadata file')
      return
    }

    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const jsonContent = e.target?.result as string
        const metadata = JSON.parse(jsonContent) as HeightmapMetadata
        
        // Validate metadata
        if (typeof metadata.minElevation !== 'number' || typeof metadata.maxElevation !== 'number') {
          alert('Invalid metadata format. Expected: { minElevation: number, maxElevation: number, bounds?: {...} }')
          return
        }

        setHeightmapMetadata(metadata)
        
        // Auto-update base elevation and displacement scale from metadata
        setHeightmapBaseElevation(metadata.minElevation)
        setHeightmapDisplacementScale(metadata.maxElevation - metadata.minElevation)
        
        console.log('Heightmap metadata loaded:', metadata)
        alert(`Metadata loaded!\nMin elevation: ${metadata.minElevation}m\nMax elevation: ${metadata.maxElevation}m`)
      } catch (error) {
        alert(`Failed to parse metadata JSON: ${error}`)
      }
    }
    reader.onerror = () => {
      alert('Failed to load metadata file')
    }
    reader.readAsText(file)
  }

  const terrainMeshTypes: { value: TerrainMeshType; label: string }[] = [
    { value: 'none', label: 'None' },
    { value: 'delaunay', label: 'Delaunay Triangulation' },
    { value: 'heightmap', label: 'Heightmap (DEM)' },
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

  // Calculate trail bounds for zoom-to-fit
  const trailBounds = useMemo(() => {
    return calculateTrailBounds(skiFeatures, center, elevationScale)
  }, [skiFeatures, center, elevationScale])

  // State to trigger camera reset
  const [resetCameraRequested, setResetCameraRequested] = useState(false)

  // Reset camera to default view (mountain center, fit all trails)
  const resetCameraView = useCallback(() => {
    setResetCameraRequested(true)
    // Reset flag after a short delay to allow the handler to process it
    setTimeout(() => setResetCameraRequested(false), 100)
  }, [])

  // Double-tap handler for reset
  const lastTapTimeRef = useRef<number>(0)
  const lastTapPositionRef = useRef<{ x: number; y: number } | null>(null)
  
  const handleDoubleTap = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    const currentTime = Date.now()
    const tapLength = currentTime - lastTapTimeRef.current
    
    // Get tap position
    let tapX: number, tapY: number
    if ('touches' in e && e.touches.length > 0) {
      tapX = e.touches[0].clientX
      tapY = e.touches[0].clientY
    } else if ('changedTouches' in e && e.changedTouches.length > 0) {
      tapX = e.changedTouches[0].clientX
      tapY = e.changedTouches[0].clientY
    } else {
      tapX = (e as React.MouseEvent).clientX
      tapY = (e as React.MouseEvent).clientY
    }
    
    // Check if taps are close together (within 50px)
    const positionMatch = lastTapPositionRef.current 
      ? Math.abs(tapX - lastTapPositionRef.current.x) < 50 && 
        Math.abs(tapY - lastTapPositionRef.current.y) < 50
      : true
    
    if (tapLength < 300 && tapLength > 0 && positionMatch) {
      // Double tap detected
      e.preventDefault()
      resetCameraView()
      lastTapTimeRef.current = 0 // Reset to prevent triple-tap
      lastTapPositionRef.current = null
    } else {
      lastTapTimeRef.current = currentTime
      lastTapPositionRef.current = { x: tapX, y: tapY }
    }
  }, [resetCameraView])

  return (
    <div 
      className="relative w-full h-full" 
      style={{ width: '100%', height: '100%', backgroundColor: '#ffffff', position: 'absolute', top: 0, left: 0 }}
      onDoubleClick={handleDoubleTap}
      onTouchEnd={handleDoubleTap}
    >
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
        
        {/* Lighting for clean, bright terrain */}
        <ambientLight intensity={1.0} />
        {/* Main directional light from above */}
        <directionalLight 
          position={[0, 3, 1]} 
          intensity={0.8} 
          color="#ffffff"
        />
        {/* Fill light for even illumination */}
        <directionalLight 
          position={[-1, 2, -1]} 
          intensity={1.9} 
          color="#f0f8ff"
        />
        
        {/* Camera */}
        <PerspectiveCamera makeDefault position={[0, 1000, 1000]} fov={60} near={10} far={100000} />
        <OrbitControls
          ref={controlsRef}
          enablePan={false}
          enableZoom={true}
          zoomSpeed={0.8}
          enableRotate={false}
          minDistance={100}
          maxDistance={50000}
          target={[0, 0, 0]}
          screenSpacePanning={false}
          enableDamping={true}
          dampingFactor={0.05}
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
          onTerrainGeometryReady={(geometry) => {
            terrainGeometryRef.current = geometry
          }}
          importedMeshGeometry={importedMeshGeometry}
          heightmapUrl={heightmapUrl}
          heightmapMetadata={heightmapMetadata}
          heightmapDisplacementScale={heightmapDisplacementScale}
          heightmapBaseElevation={heightmapBaseElevation}
          heightmapSegments={heightmapSegments}
          heightmapElevationOffset={heightmapElevationOffset}
          heightmapRotationDeg={heightmapRotationDeg}
          heightmapFlipX={heightmapFlipX}
          heightmapFlipZ={heightmapFlipZ}
          userRunCompletions={userRunCompletions}
        />
        
        {/* Auto-position camera based on trails */}
        <CameraController 
          skiFeatures={skiFeatures} 
          center={center}
          controlsRef={controlsRef}
          elevationScale={elevationScale}
          screenTargetPosition={[0.5, 0.1]}
          onConeParamsChange={(params) => {
            // Store cone params for visualization
            setConeParams(params)
          }}
        />
        
        {/* Visualize cone constraint grid (for development) */}
        {showConeGrid && coneParams.centerPoint && (
          <ConeVisualization
            centerPoint={coneParams.centerPoint}
            maxY={coneParams.maxY}
            minY={coneParams.minY}
            maxRadius={coneParams.maxRadius}
            mountainConeProfile={coneParams.mountainConeProfile}
            show={showConeGrid}
          />
        )}
        
        {/* Handle camera reset requests */}
        <ResetCameraHandler 
          onResetRequested={resetCameraRequested}
          trailBounds={trailBounds}
          controlsRef={controlsRef}
        />
        
        {/* Ground plane indicator at Y=0 (sea level) - for debugging */}
        {showAxes && (
          <mesh position={[0, 0, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[50000, 50000]} />
            <meshBasicMaterial 
              color="#888888" 
              transparent 
              opacity={0.1} 
              side={THREE.DoubleSide}
              wireframe={true}
            />
          </mesh>
        )}
        
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
              checked={showConeGrid}
              onChange={(e) => setShowConeGrid(e.target.checked)}
              className="w-3 h-3"
            />
            <span>Show Cone Grid (dev)</span>
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
            
            {terrainMeshType === 'heightmap' && (
              <div className="mt-2 mb-2 pt-2 border-t border-gray-200">
                <label className="block text-xs font-semibold mb-2">Heightmap Settings:</label>
                <button
                  onClick={() => heightmapInputRef.current?.click()}
                  className="w-full px-3 py-2 text-xs bg-purple-500 text-white rounded hover:bg-purple-600 transition-colors mb-2"
                  title="Load DEM heightmap (GeoTIFF with coordinates, or PNG/JPG)"
                >
                  {heightmapUrl ? 'Change Heightmap' : 'Load Heightmap (GeoTIFF/Image)'}
                </button>
                <input
                  ref={heightmapInputRef}
                  type="file"
                  accept="image/*,.tif,.tiff"
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) {
                      loadHeightmapFromFile(file)
                    }
                    // Reset input so same file can be selected again
                    e.target.value = ''
                  }}
                  className="hidden"
                />
                <p className="text-xs text-gray-500 mb-2">
                  Supports GeoTIFF (.tif) with embedded coordinates, or regular images (PNG, JPG)
                </p>
                {heightmapUrl && (
                  <>
                    <div className="mt-2 mb-2">
                      <label className="block text-xs mb-1">
                        Displacement Scale: {heightmapDisplacementScale.toFixed(0)}m
                      </label>
                      <input
                        type="range"
                        min="100"
                        max="5000"
                        step="100"
                        value={heightmapDisplacementScale}
                        onChange={(e) => setHeightmapDisplacementScale(parseFloat(e.target.value))}
                        className="w-full"
                      />
                      <p className="text-xs text-gray-500 mt-1">
                        Max elevation height (meters) for white pixels
                      </p>
                    </div>
                    {/* Orientation controls */}
                    <div className="mt-2 mb-2">
                      <label className="block text-xs font-semibold mb-1">
                        DEM Orientation
                      </label>
                      <div className="flex items-center gap-2 mb-2">
                        <button
                          onClick={() => setHeightmapRotationDeg((deg) => (deg + 270) % 360)}
                          className="px-2 py-1 text-xs bg-gray-200 rounded hover:bg-gray-300"
                          title="Rotate -90°"
                        >
                          ⟲ 90°
                        </button>
                        <button
                          onClick={() => setHeightmapRotationDeg((deg) => (deg + 90) % 360)}
                          className="px-2 py-1 text-xs bg-gray-200 rounded hover:bg-gray-300"
                          title="Rotate +90°"
                        >
                          ⟳ 90°
                        </button>
                        <span className="text-xs text-gray-600 ml-1">
                          Rotation: {heightmapRotationDeg}°
                        </span>
                      </div>
                      <label className="flex items-center gap-2 text-xs cursor-pointer mb-1">
                        <input
                          type="checkbox"
                          checked={heightmapFlipX}
                          onChange={(e) => setHeightmapFlipX(e.target.checked)}
                          className="w-3 h-3"
                        />
                        <span>Flip X (east/west)</span>
                      </label>
                      <label className="flex items-center gap-2 text-xs cursor-pointer">
                        <input
                          type="checkbox"
                          checked={heightmapFlipZ}
                          onChange={(e) => setHeightmapFlipZ(e.target.checked)}
                          className="w-3 h-3"
                        />
                        <span>Flip Z (north/south)</span>
                      </label>
                    </div>
                    <div className="mt-2 mb-2">
                      <label className="block text-xs mb-1">
                        Elevation Offset: {heightmapElevationOffset.toFixed(1)}m
                      </label>
                      <input
                        type="range"
                        min="-200"
                        max="200"
                        step="1"
                        value={heightmapElevationOffset}
                        onChange={(e) => setHeightmapElevationOffset(parseFloat(e.target.value))}
                        className="w-full"
                      />
                      <p className="text-xs text-gray-500 mt-1">
                        Adjust DEM up/down to match runs (positive = raise terrain, negative = lower terrain)
                      </p>
                    </div>
                    <div className="mt-2 mb-2">
                      <label className="block text-xs mb-1">
                        Base Elevation: {heightmapBaseElevation.toFixed(0)}m
                      </label>
                      <input
                        type="range"
                        min="-500"
                        max="5000"
                        step="10"
                        value={heightmapBaseElevation}
                        onChange={(e) => setHeightmapBaseElevation(parseFloat(e.target.value))}
                        className="w-full"
                      />
                      <p className="text-xs text-gray-500 mt-1">
                        Elevation for black pixels (meters above sea level)
                      </p>
                    </div>
                    <div className="mt-2 mb-2">
                      <label className="block text-xs mb-1">
                        Mesh Resolution: {heightmapSegments}×{heightmapSegments}
                      </label>
                      <input
                        type="range"
                        min="20"
                        max="200"
                        step="10"
                        value={heightmapSegments}
                        onChange={(e) => setHeightmapSegments(parseInt(e.target.value))}
                        className="w-full"
                      />
                      <p className="text-xs text-gray-500 mt-1">
                        Higher = more detail, slower performance
                      </p>
                    </div>
                    <button
                      onClick={() => {
                        setHeightmapUrl(null)
                        setHeightmapMetadata(null)
                        if (terrainMeshType === 'heightmap') {
                          setTerrainMeshType('delaunay')
                        }
                      }}
                      className="w-full px-3 py-2 text-xs bg-red-500 text-white rounded hover:bg-red-600 transition-colors"
                      title="Clear heightmap and metadata"
                    >
                      Clear Heightmap & Metadata
                    </button>
                  </>
                )}
              </div>
            )}
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
                    Terrain Color:
                  </label>
                  <input
                    type="color"
                    value={terrainColor}
                    onChange={(e) => setTerrainColor(e.target.value)}
                    className="w-full h-6 cursor-pointer"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Frosted glass tint color
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

