/**
 * Coordinate conversion utilities for deck.gl integration
 * Converts between WGS84 (lat/lng) and Web Mercator (EPSG:3857)
 * Matches the coordinate system used in qgisthreejs export
 */

// Scene origin from qgisthreejs export (Web Mercator coordinates)
export const SCENE_ORIGIN = {
  x: -13241170.601572648,
  y: 6400333.522211134,
  z: 0.0,
}

// Elevation scale from qgisthreejs export
export const Z_SCALE = 3.0

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
 * @param elevation Elevation in meters (optional)
 * @returns [x, y, z] in scene coordinates
 */
export function latLngToSceneCoords(
  lat: number,
  lng: number,
  elevation: number = 0
): [number, number, number] {
  const [mercX, mercY] = latLngToWebMercator(lat, lng)
  const x = mercX - SCENE_ORIGIN.x
  const y = -(mercY - SCENE_ORIGIN.y) // Flip Y to match Three.js convention
  const z = (elevation - SCENE_ORIGIN.z) * Z_SCALE
  return [x, y, z]
}

/**
 * Convert GeoJSON coordinates to scene coordinates
 * GeoJSON format: [lng, lat, elevation?]
 * @param coord GeoJSON coordinate array
 * @returns [x, y, z] in scene coordinates
 */
export function geoJsonToSceneCoords(coord: number[]): [number, number, number] {
  const lng = coord[0]
  const lat = coord[1]
  const elevation = coord.length > 2 ? coord[2] : 0
  return latLngToSceneCoords(lat, lng, elevation)
}

/**
 * Convert scene coordinates back to lat/lng
 * @param x Scene X coordinate
 * @param y Scene Y coordinate
 * @param z Scene Z coordinate (elevation)
 * @returns [lat, lng, elevation] in degrees and meters
 */
export function sceneCoordsToLatLng(
  x: number,
  y: number,
  z: number
): [number, number, number] {
  const mercX = x + SCENE_ORIGIN.x
  const mercY = -(y - SCENE_ORIGIN.y) // Unflip Y
  const [lat, lng] = webMercatorToLatLng(mercX, mercY)
  const elevation = z / Z_SCALE + SCENE_ORIGIN.z
  return [lat, lng, elevation]
}


