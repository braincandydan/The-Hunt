/**
 * Utility functions for extracting and formatting elevation data
 * for use with leaflet-elevation plugin
 */

export interface ElevationPoint {
  lat: number
  lng: number
  elevation: number // in meters
}

/**
 * Extract elevation data from GeoJSON coordinates
 * Supports LineString and MultiLineString with Z values
 */
export function extractElevationFromCoordinates(
  coordinates: number[][] | number[][][] | number[][][][]
): ElevationPoint[] {
  const points: ElevationPoint[] = []

  // Handle LineString: [[lng, lat, z], ...]
  if (Array.isArray(coordinates) && coordinates.length > 0) {
    const firstCoord = coordinates[0]
    
    // Check if it's a 3D coordinate [lng, lat, z]
    if (Array.isArray(firstCoord) && typeof firstCoord[0] === 'number' && firstCoord.length >= 3) {
      // LineString format: number[][]
      const lineCoords = coordinates as number[][]
      lineCoords.forEach((coord) => {
        if (coord.length >= 3 && typeof coord[2] === 'number') {
          points.push({
            lng: coord[0],
            lat: coord[1],
            elevation: coord[2],
          })
        }
      })
    } else if (Array.isArray(firstCoord) && Array.isArray(firstCoord[0])) {
      // MultiLineString format: [[[lng, lat, z], ...], ...]
      const multiCoords = coordinates as number[][][]
      multiCoords.forEach((line) => {
        line.forEach((coord) => {
          if (coord.length >= 3 && typeof coord[2] === 'number') {
            points.push({
              lng: coord[0],
              lat: coord[1],
              elevation: coord[2],
            })
          }
        })
      })
    }
  }

  return points
}

/**
 * Extract elevation from metadata properties
 */
export function extractElevationFromMetadata(metadata: any): number | null {
  if (!metadata) return null

  const originalProps = metadata.original_properties || {}
  
  // Try multiple common elevation field names
  const elevation = originalProps.elevation || 
                   originalProps.ele || 
                   originalProps.elevation_max ||
                   originalProps.elevation_min ||
                   originalProps.height ||
                   originalProps.elevation_avg

  if (elevation !== undefined && elevation !== null) {
    const elevationMeters = typeof elevation === 'number' ? elevation : parseFloat(elevation)
    if (!isNaN(elevationMeters)) {
      return elevationMeters
    }
  }

  return null
}

/**
 * Create a GeoJSON Feature with elevation data for leaflet-elevation
 * This converts trail data into a format the elevation plugin can use
 */
export function createElevationGeoJSON(
  geometry: any,
  metadata?: any
): GeoJSON.Feature<GeoJSON.LineString | GeoJSON.MultiLineString> | null {
  // Extract elevation points from coordinates
  let elevationPoints = extractElevationFromCoordinates(geometry.coordinates)

  // If no elevation in coordinates, try to get from metadata
  if (elevationPoints.length === 0) {
    const metadataElevation = extractElevationFromMetadata(metadata)
    
    if (metadataElevation !== null && geometry.coordinates) {
      // Create elevation points from coordinates using metadata elevation
      const coords = geometry.type === 'LineString' 
        ? geometry.coordinates 
        : geometry.coordinates.flat()
      
      elevationPoints = coords.map((coord: number[]) => ({
        lng: coord[0],
        lat: coord[1],
        elevation: metadataElevation, // Use single elevation value
      }))
    }
  }

  // If still no elevation data, return null
  if (elevationPoints.length === 0) {
    return null
  }

  // Create GeoJSON LineString with 3D coordinates
  const coordinates3D = elevationPoints.map((point) => [
    point.lng,
    point.lat,
    point.elevation,
  ])

  // Build geometry based on type
  if (geometry.type === 'MultiLineString') {
    return {
      type: 'Feature',
      geometry: {
        type: 'MultiLineString' as const,
        coordinates: [coordinates3D],
      },
      properties: {},
    }
  }
  
  return {
    type: 'Feature',
    geometry: {
      type: 'LineString' as const,
      coordinates: coordinates3D,
    },
    properties: {},
  }
}

/**
 * Calculate elevation statistics from elevation points
 */
export function calculateElevationStats(points: ElevationPoint[]): {
  min: number
  max: number
  gain: number
  loss: number
  average: number
} {
  if (points.length === 0) {
    return { min: 0, max: 0, gain: 0, loss: 0, average: 0 }
  }

  const elevations = points.map((p) => p.elevation)
  const min = Math.min(...elevations)
  const max = Math.max(...elevations)
  const average = elevations.reduce((sum, e) => sum + e, 0) / elevations.length

  // Calculate total elevation gain and loss
  let gain = 0
  let loss = 0

  for (let i = 1; i < points.length; i++) {
    const diff = points[i].elevation - points[i - 1].elevation
    if (diff > 0) {
      gain += diff
    } else {
      loss += Math.abs(diff)
    }
  }

  return { min, max, gain, loss, average }
}

