/**
 * Utility to load GeoJSON files from the public folder
 * Used for loading QGIS exports (tree lines, runs, etc.)
 */

export interface GeoJSONFeature {
  type: 'Feature'
  geometry: {
    type: 'LineString' | 'Polygon' | 'MultiLineString' | 'MultiPolygon' | 'Point'
    coordinates: number[] | number[][] | number[][][]
  }
  properties?: Record<string, any>
}

export interface GeoJSONFeatureCollection {
  type: 'FeatureCollection'
  features: GeoJSONFeature[]
}

/**
 * Load a GeoJSON file from the public folder
 * @param path Path to GeoJSON file (e.g., '/3d-map/geojson/tree-line.json')
 * @returns Promise with GeoJSON feature collection
 */
export async function loadGeoJSONFile(path: string): Promise<GeoJSONFeatureCollection | null> {
  try {
    const response = await fetch(path)
    if (!response.ok) {
      console.warn(`Failed to load GeoJSON from ${path}: ${response.statusText}`)
      return null
    }
    const data = await response.json()
    
    // Handle both FeatureCollection and single Feature
    if (data.type === 'FeatureCollection') {
      return data as GeoJSONFeatureCollection
    } else if (data.type === 'Feature') {
      return {
        type: 'FeatureCollection',
        features: [data as GeoJSONFeature],
      }
    } else {
      console.warn(`Invalid GeoJSON format in ${path}`)
      return null
    }
  } catch (error) {
    console.error(`Error loading GeoJSON from ${path}:`, error)
    return null
  }
}

/**
 * Load multiple GeoJSON files
 * @param paths Array of paths to GeoJSON files
 * @returns Promise with array of feature collections
 */
export async function loadMultipleGeoJSONFiles(
  paths: string[]
): Promise<GeoJSONFeatureCollection[]> {
  const results = await Promise.all(paths.map(loadGeoJSONFile))
  return results.filter((result): result is GeoJSONFeatureCollection => result !== null)
}

/**
 * Merge multiple GeoJSON feature collections into one
 * @param collections Array of feature collections
 * @returns Merged feature collection
 */
export function mergeGeoJSONCollections(
  collections: GeoJSONFeatureCollection[]
): GeoJSONFeatureCollection {
  return {
    type: 'FeatureCollection',
    features: collections.flatMap((collection) => collection.features),
  }
}


