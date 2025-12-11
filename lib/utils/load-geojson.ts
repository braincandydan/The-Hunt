/**
 * Utility to load GeoJSON files from the public folder
 * Used for loading QGIS exports (tree lines, runs, etc.)
 * Includes caching and request deduplication
 */

export interface GeoJSONFeature {
  type: 'Feature'
  geometry: {
    type: 'LineString' | 'Polygon' | 'MultiLineString' | 'MultiPolygon' | 'Point'
    coordinates: number[] | number[][] | number[][][]
  }
  properties?: Record<string, unknown>
}

export interface GeoJSONFeatureCollection {
  type: 'FeatureCollection'
  features: GeoJSONFeature[]
}

// In-memory cache for loaded GeoJSON files
const geoJSONCache = new Map<string, GeoJSONFeatureCollection>()

// Pending request deduplication
const pendingRequests = new Map<string, Promise<GeoJSONFeatureCollection | null>>()

/**
 * Load a GeoJSON file from the public folder with caching
 * @param path Path to GeoJSON file (e.g., '/3d-map/geojson/tree-line.json')
 * @returns Promise with GeoJSON feature collection
 */
export async function loadGeoJSONFile(path: string): Promise<GeoJSONFeatureCollection | null> {
  // Check cache first
  const cached = geoJSONCache.get(path)
  if (cached) {
    return cached
  }

  // Check if there's already a pending request for this path
  const pending = pendingRequests.get(path)
  if (pending) {
    return pending
  }

  // Create new request and store it for deduplication
  const requestPromise = (async (): Promise<GeoJSONFeatureCollection | null> => {
    try {
      const response = await fetch(path)
      if (!response.ok) {
        return null
      }
      const data = await response.json()
      
      let result: GeoJSONFeatureCollection | null = null
      
      // Handle both FeatureCollection and single Feature
      if (data.type === 'FeatureCollection') {
        result = data as GeoJSONFeatureCollection
      } else if (data.type === 'Feature') {
        result = {
          type: 'FeatureCollection',
          features: [data as GeoJSONFeature],
        }
      }
      
      // Cache successful results
      if (result) {
        geoJSONCache.set(path, result)
      }
      
      return result
    } catch {
      return null
    } finally {
      // Clean up pending request
      pendingRequests.delete(path)
    }
  })()

  pendingRequests.set(path, requestPromise)
  return requestPromise
}

/**
 * Load multiple GeoJSON files in parallel
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

/**
 * Clear the GeoJSON cache (useful for development)
 */
export function clearGeoJSONCache(): void {
  geoJSONCache.clear()
}
