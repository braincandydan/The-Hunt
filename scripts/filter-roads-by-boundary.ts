import * as fs from 'fs'
import * as path from 'path'
import { booleanIntersects, lineString, polygon } from '@turf/turf'
import type { Feature, FeatureCollection, LineString, MultiLineString, Polygon } from 'geojson'

// Load boundary polygon
const boundaryPath = path.join(process.cwd(), 'kelownaArea.json')
const boundaryData: Polygon = JSON.parse(fs.readFileSync(boundaryPath, 'utf-8'))

// Load roads GeoJSON
const roadsPath = path.join(process.cwd(), 'RDCO_Roads.geojson')
const roadsData: FeatureCollection = JSON.parse(fs.readFileSync(roadsPath, 'utf-8'))

console.log(`Loaded boundary with ${boundaryData.coordinates[0].length} vertices`)
console.log(`Loaded ${roadsData.features.length} road features`)

// Filter roads that intersect with the boundary
const filteredFeatures: Feature[] = []
let processed = 0

for (const feature of roadsData.features) {
  processed++
  if (processed % 100 === 0) {
    console.log(`Processing... ${processed}/${roadsData.features.length}`)
  }

  const geometry = feature.geometry
  
  // Handle LineString
  if (geometry.type === 'LineString') {
    const line = lineString(geometry.coordinates)
    if (booleanIntersects(line, polygon(boundaryData.coordinates))) {
      filteredFeatures.push(feature)
    }
  }
  // Handle MultiLineString
  else if (geometry.type === 'MultiLineString') {
    let intersects = false
    for (const lineCoords of geometry.coordinates) {
      const line = lineString(lineCoords)
      if (booleanIntersects(line, polygon(boundaryData.coordinates))) {
        intersects = true
        break
      }
    }
    if (intersects) {
      filteredFeatures.push(feature)
    }
  }
}

console.log(`\nFiltered to ${filteredFeatures.length} roads within boundary`)

// Create filtered FeatureCollection
const filteredGeoJSON: FeatureCollection = {
  type: 'FeatureCollection',
  features: filteredFeatures,
}

// Write filtered roads to new file
const outputPath = path.join(process.cwd(), 'RDCO_Roads_Filtered.geojson')
fs.writeFileSync(outputPath, JSON.stringify(filteredGeoJSON, null, 2))

console.log(`\n✅ Filtered roads saved to: ${outputPath}`)
console.log(`   Original: ${roadsData.features.length} roads`)
console.log(`   Filtered: ${filteredFeatures.length} roads`)
console.log(`   Removed: ${roadsData.features.length - filteredFeatures.length} roads`)

