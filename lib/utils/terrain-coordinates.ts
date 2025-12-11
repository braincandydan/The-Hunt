/**
 * Coordinate conversion utilities for qgisthreejs terrain
 * Converts between WGS84 (lat/lng) and qgisthreejs scene coordinates
 * 
 * Scene uses Web Mercator (EPSG:3857) with origin at scene center
 * Elevation is scaled by zScale factor
 */

// Scene metadata from qgisthreejs export
export interface SceneMetadata {
  origin: { x: number; y: number; z: number }
  zScale: number
  baseExtent: {
    cx: number
    cy: number
    width: number
    height: number
  }
}

// Default values from scene.json (will be loaded dynamically)
const DEFAULT_SCENE_METADATA: SceneMetadata = {
  origin: { x: -13241170.601572648, y: 6400333.522211134, z: 0.0 },
  zScale: 3.0,
  baseExtent: {
    cx: -13241170.601572648,
    cy: 6400333.522211134,
    width: 10432.122135419399,
    height: 10432.122135419399,
  },
}

/**
 * Convert latitude/longitude to Web Mercator (EPSG:3857)
 * @param lat Latitude in degrees
 * @param lng Longitude in degrees
 * @returns [x, y] in Web Mercator meters
 */
export function latLngToWebMercator(lat: number, lng: number): [number, number] {
  const x = lng * 20037508.34 / 180
  let y = Math.log(Math.tan((90 + lat) * Math.PI / 360)) / (Math.PI / 180)
  y = y * 20037508.34 / 180
  return [x, y]
}

/**
 * Convert Web Mercator to latitude/longitude
 * @param x X coordinate in Web Mercator meters
 * @param y Y coordinate in Web Mercator meters
 * @returns [lat, lng] in degrees
 */
export function webMercatorToLatLng(x: number, y: number): [number, number] {
  const lng = (x / 20037508.34) * 180
  let lat = (y / 20037508.34) * 180
  lat = 180 / Math.PI * (2 * Math.atan(Math.exp(lat * Math.PI / 180)) - Math.PI / 2)
  return [lat, lng]
}

/**
 * Convert lat/lng to scene coordinates (relative to scene origin)
 * @param lat Latitude in degrees
 * @param lng Longitude in degrees
 * @param elevation Elevation in meters (optional, will be 0 if not provided)
 * @param sceneMetadata Scene metadata with origin and zScale
 * @returns [x, y, z] in scene coordinates (Three.js: x=right, y=up, z=forward)
 */
export function latLngToSceneCoords(
  lat: number,
  lng: number,
  elevation: number = 0,
  sceneMetadata: SceneMetadata = DEFAULT_SCENE_METADATA
): [number, number, number] {
  // Convert to Web Mercator
  const [mercX, mercY] = latLngToWebMercator(lat, lng)
  
  // Transform to scene coordinates (relative to origin)
  const x = mercX - sceneMetadata.origin.x
  const z = -(mercY - sceneMetadata.origin.y) // Flip Y to Z (Three.js convention: Y is up)
  const y = (elevation - sceneMetadata.origin.z) * sceneMetadata.zScale
  
  return [x, y, z]
}

/**
 * Convert GeoJSON coordinates to scene coordinates
 * GeoJSON format: [lng, lat, elevation?]
 * @param coord GeoJSON coordinate array
 * @param sceneMetadata Scene metadata with origin and zScale
 * @returns [x, y, z] in scene coordinates
 */
export function geoJsonToSceneCoords(
  coord: number[],
  sceneMetadata: SceneMetadata = DEFAULT_SCENE_METADATA
): [number, number, number] {
  const lng = coord[0]
  const lat = coord[1]
  const elevation = coord.length > 2 ? coord[2] : 0
  return latLngToSceneCoords(lat, lng, elevation, sceneMetadata)
}

/**
 * Convert scene coordinates back to lat/lng
 * @param x Scene X coordinate
 * @param y Scene Y coordinate (elevation)
 * @param z Scene Z coordinate
 * @param sceneMetadata Scene metadata with origin and zScale
 * @returns [lat, lng, elevation] in degrees and meters
 */
export function sceneCoordsToLatLng(
  x: number,
  y: number,
  z: number,
  sceneMetadata: SceneMetadata = DEFAULT_SCENE_METADATA
): [number, number, number] {
  // Convert back to Web Mercator
  const mercX = x + sceneMetadata.origin.x
  const mercY = -(z - sceneMetadata.origin.y) // Unflip Z to Y
  
  // Convert to lat/lng
  const [lat, lng] = webMercatorToLatLng(mercX, mercY)
  
  // Convert elevation back
  const elevation = y / sceneMetadata.zScale + sceneMetadata.origin.z
  
  return [lat, lng, elevation]
}

/**
 * Load scene metadata from scene.json
 * @param sceneJsonPath Path to scene.json file
 * @returns Promise with scene metadata
 */
export async function loadSceneMetadata(sceneJsonPath: string = '/3d-map/data/index/scene.json'): Promise<SceneMetadata> {
  try {
    const response = await fetch(sceneJsonPath)
    const data = await response.json()
    
    if (data.type === 'scene' && data.properties) {
      return {
        origin: data.properties.origin,
        zScale: data.properties.zScale || 3.0,
        baseExtent: data.properties.baseExtent,
      }
    }
    
    // Fallback to default
    return DEFAULT_SCENE_METADATA
  } catch (error) {
    console.error('Failed to load scene metadata:', error)
    return DEFAULT_SCENE_METADATA
  }
}
