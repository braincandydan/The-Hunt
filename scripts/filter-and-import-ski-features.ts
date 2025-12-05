/**
 * Script to filter OpenSkiMap GeoJSON by resort ID and import
 * 
 * This handles large files with multiple resorts by filtering first, then importing
 * 
 * Usage:
 *   npx tsx scripts/filter-and-import-ski-features.ts <db-resort-id> <openskimap-id> <geojson-file> [feature-type]
 * 
 * Example:
 *   npx tsx scripts/filter-and-import-ski-features.ts "your-db-uuid" "4e9295e870b927f90f542cd716b60fe0c2b04cb8" docs/lifts.geojson lift
 *   npx tsx scripts/filter-and-import-ski-features.ts "your-db-uuid" "4e9295e870b927f90f542cd716b60fe0c2b04cb8" docs/runs.geojson trail
 */

import { createClient } from '@supabase/supabase-js'
import * as fs from 'fs'
import { config } from 'dotenv'
import * as readline from 'readline'

// Load environment variables from .env.local
config({ path: '.env.local' })

// Load environment variables
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseKey) {
  console.error('Error: Missing Supabase credentials')
  console.error('Make sure NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or NEXT_PUBLIC_SUPABASE_ANON_KEY) are set')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)

interface GeoJSONFeature {
  type: string
  properties: any
  geometry: {
    type: string
    coordinates: any
  }
}

interface GeoJSONFeatureCollection {
  type: 'FeatureCollection'
  features: GeoJSONFeature[]
}

function mapOpenSkiMapDifficulty(difficulty: string): 'green' | 'blue' | 'black' | 'double-black' | 'terrain-park' | 'other' | null {
  const difficultyMap: Record<string, 'green' | 'blue' | 'black' | 'double-black' | 'terrain-park' | 'other'> = {
    'novice': 'green',
    'easy': 'green',
    'beginner': 'green',
    'intermediate': 'blue',
    'advanced': 'black',
    'expert': 'black',
    'extreme': 'double-black',
    'freeride': 'double-black',
    'park': 'terrain-park',
    'terrain-park': 'terrain-park',
  }
  
  if (!difficulty) return null
  
  const normalized = difficulty.toLowerCase().trim()
  return difficultyMap[normalized] || 'other'
}

function belongsToResort(feature: GeoJSONFeature, openSkiMapResortId: string): boolean {
  // Check if feature has skiAreas array
  if (feature.properties.skiAreas && Array.isArray(feature.properties.skiAreas)) {
    return feature.properties.skiAreas.some((area: any) => 
      area.properties && area.properties.id === openSkiMapResortId
    )
  }
  
  // Check if feature itself is a ski area with matching ID
  if (feature.properties.id === openSkiMapResortId && feature.properties.type === 'skiArea') {
    return true
  }
  
  // For runs, check if they're linked to the resort
  // (runs might have different structure - adjust as needed)
  if (feature.properties.resort_id === openSkiMapResortId) {
    return true
  }
  
  return false
}

function filterFeaturesByResort(
  geoJson: GeoJSONFeatureCollection, 
  openSkiMapResortId: string
): GeoJSONFeatureCollection {
  console.log(`Filtering features for OpenSkiMap ID: ${openSkiMapResortId}`)
  
  const filtered = geoJson.features.filter(feature => belongsToResort(feature, openSkiMapResortId))
  
  console.log(`Found ${filtered.length} features out of ${geoJson.features.length} total`)
  
  return {
    type: 'FeatureCollection',
    features: filtered,
  }
}

function mapOpenSkiMapToFeatureType(properties: any, geometryType: string): 'trail' | 'lift' | 'boundary' | 'area' {
  // For ski areas, use 'boundary' if it has Polygon geometry, otherwise 'area'
  if (properties.type === 'skiArea' || properties.type === 'area') {
    return geometryType === 'Polygon' || geometryType === 'MultiPolygon' ? 'boundary' : 'area'
  }
  
  if (properties.piste_type === 'downhill' || 
      properties.piste_type === 'nordic' ||
      properties.piste === 'yes' ||
      properties.type === 'piste' ||
      properties.type === 'run') {
    return 'trail'
  }
  
  if (properties.aerialway || 
      properties.aerialway_type ||
      properties.type === 'aerialway' ||
      properties.type === 'lift' ||
      properties.lift === 'yes' ||
      properties.liftType) {
    return 'lift'
  }
  
  if (properties.boundary || 
      properties.type === 'boundary' ||
      (geometryType === 'Polygon' && properties.type === 'skiArea')) {
    return 'boundary'
  }
  
  if (geometryType === 'Polygon') {
    return 'area'
  }
  
  return 'trail'
}

async function streamLargeGeoJSON(filePath: string, openSkiMapResortId: string): Promise<GeoJSONFeatureCollection> {
  console.log(`Streaming large file: ${filePath}`)
  console.log(`Looking for features with OpenSkiMap ID: ${openSkiMapResortId}`)
  
  const fileStream = fs.createReadStream(filePath, { encoding: 'utf-8' })
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  })
  
  let featureCount = 0
  let matchedCount = 0
  const matchedFeatures: GeoJSONFeature[] = []
  
  for await (const line of rl) {
    const trimmed = line.trim()
    
    // Skip empty lines and header/footer lines
    if (!trimmed || trimmed === '{' || trimmed === '}' || trimmed === '[' || trimmed === ']' || trimmed.startsWith('"type":')) {
      continue
    }
    
    // Each feature is on a single line - can start with {"type":"Feature" or {"properties"
    // ski_areas.geojson has properties first: {"properties":{...},"type":"Feature"
    // Other files have type first: {"type":"Feature","properties":{...}
    if (trimmed.startsWith('{"type":"Feature"') || 
        (trimmed.startsWith('{"properties"') && trimmed.includes('"type":"Feature"')) ||
        (trimmed.startsWith('{"properties"') && trimmed.includes('"type":"skiArea"'))) {
      try {
        // Parse the complete feature from the line
        // Remove trailing comma if present (GeoJSON arrays have commas between items)
        const cleanLine = trimmed.replace(/,\s*$/, '')
        const feature: GeoJSONFeature = JSON.parse(cleanLine)
        featureCount++
        
        if (belongsToResort(feature, openSkiMapResortId)) {
          matchedFeatures.push(feature)
          matchedCount++
          
          // Show progress for matches
          if (matchedCount <= 5 || matchedCount % 10 === 0) {
            const name = feature.properties?.name || 'Unnamed'
            process.stdout.write(`\r  ✓ Found ${matchedCount} matches (latest: ${name.substring(0, 30)})...`)
          }
        }
        
        // Show progress every 5000 features processed
        if (featureCount % 5000 === 0) {
          process.stdout.write(`\r  Processed ${featureCount} features, found ${matchedCount} matches...`)
        }
      } catch (e) {
        // Skip malformed features - might be header/footer or incomplete JSON
        // Silent skip for performance
      }
    }
  }
  
  console.log(`\n  Total features processed: ${featureCount}`)
  console.log(`  Features matched for this resort: ${matchedCount}`)
  
  return {
    type: 'FeatureCollection',
    features: matchedFeatures,
  }
}

async function importGeoJSON(
  dbResortId: string, 
  filePath: string, 
  openSkiMapResortId: string,
  featureType?: 'trail' | 'lift' | 'boundary' | 'area'
) {
  console.log(`\n=== Importing Ski Features ===`)
  console.log(`Database Resort ID: ${dbResortId}`)
  console.log(`OpenSkiMap Resort ID: ${openSkiMapResortId}`)
  console.log(`File: ${filePath}`)
  console.log(`Feature Type: ${featureType || 'auto-detect'}\n`)
  
  // Check file size - if very large, use streaming parser
  const stats = fs.statSync(filePath)
  const fileSizeMB = stats.size / (1024 * 1024)
  
  let geoJson: GeoJSONFeatureCollection
  
  if (fileSizeMB > 10) {
    // Large file - use streaming parser
    console.log(`Large file detected (${fileSizeMB.toFixed(1)} MB), using streaming parser...`)
    geoJson = await streamLargeGeoJSON(filePath, openSkiMapResortId)
  } else {
    // Small file - load normally
    console.log(`Reading GeoJSON from: ${filePath}`)
    const fileContent = fs.readFileSync(filePath, 'utf-8')
    const fullGeoJson: GeoJSONFeatureCollection = JSON.parse(fileContent)
    
    if (fullGeoJson.type !== 'FeatureCollection') {
      console.error('Error: Expected FeatureCollection')
      process.exit(1)
    }
    
    console.log(`Total features in file: ${fullGeoJson.features.length}`)
    geoJson = filterFeaturesByResort(fullGeoJson, openSkiMapResortId)
  }
  
  if (geoJson.features.length === 0) {
    console.error('\n❌ No features found for this resort!')
    console.error(`Make sure the OpenSkiMap ID "${openSkiMapResortId}" is correct.`)
    console.error('Check the ski-area.json file to find the correct ID.')
    process.exit(1)
  }
  
  console.log(`\nProcessing ${geoJson.features.length} features...\n`)
  
  const features = []
  
  for (const feature of geoJson.features) {
    // Determine feature type
    let type: 'trail' | 'lift' | 'boundary' | 'area' = featureType || mapOpenSkiMapToFeatureType(feature.properties, feature.geometry.type)
    
    // Extract name
    const name = feature.properties.name || 
                 feature.properties.name_en || 
                 feature.properties.id || 
                 `Feature ${features.length + 1}`
    
    // Extract difficulty for trails
    const difficulty = type === 'trail' 
      ? mapOpenSkiMapDifficulty(
          feature.properties.difficulty || 
          feature.properties.piste_difficulty ||
          feature.properties.rating
        )
      : null
    
    // Extract status
    const status = feature.properties.status || 
                   feature.properties.state ||
                   'open'
    
    // Map status values
    let mappedStatus: 'open' | 'closed' | 'groomed' | 'ungroomed' = 'open'
    if (status === 'closed' || status === 'inactive') {
      mappedStatus = 'closed'
    } else if (status === 'groomed') {
      mappedStatus = 'groomed'
    } else if (status === 'ungroomed') {
      mappedStatus = 'ungroomed'
    }
    
    // Prepare metadata (store original properties for reference)
    const metadata = {
      original_properties: feature.properties,
      source: 'openskimap',
      openskimap_resort_id: openSkiMapResortId,
    }
    
    // Create database record
    const dbFeature = {
      resort_id: dbResortId,
      name,
      type,
      difficulty,
      geometry: feature.geometry,
      metadata,
      status: mappedStatus,
      active: true,
      order_index: features.length,
    }
    
    features.push(dbFeature)
    
    if (features.length <= 10 || features.length % 50 === 0) {
      console.log(`  - Prepared: ${name} (${type}${difficulty ? `, ${difficulty}` : ''})`)
    }
  }
  
  if (features.length === 0) {
    console.error('No features to import')
    process.exit(1)
  }
  
  console.log(`\nImporting ${features.length} features...`)
  
  // Insert in batches to avoid overwhelming the database
  const batchSize = 50
  for (let i = 0; i < features.length; i += batchSize) {
    const batch = features.slice(i, i + batchSize)
    const { data, error } = await supabase
      .from('ski_features')
      .insert(batch)
      .select()
    
    if (error) {
      console.error(`\n❌ Error inserting batch ${Math.floor(i / batchSize) + 1}:`, error)
      process.exit(1)
    }
    
    console.log(`  ✓ Inserted batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(features.length / batchSize)} (${batch.length} features)`)
  }
  
  console.log(`\n✅ Successfully imported ${features.length} features!`)
}

// Main execution
const args = process.argv.slice(2)

if (args.length < 3) {
  console.error('Usage: npx tsx scripts/filter-and-import-ski-features.ts <db-resort-id> <openskimap-resort-id> <geojson-file> [feature-type]')
  console.error('\nExample:')
  console.error('  # Import lifts for Big White')
  console.error('  npx tsx scripts/filter-and-import-ski-features.ts "your-db-uuid" "4e9295e870b927f90f542cd716b60fe0c2b04cb8" docs/lifts.geojson lift')
  console.error('\n  # Import runs/trails for Big White')
  console.error('  npx tsx scripts/filter-and-import-ski-features.ts "your-db-uuid" "4e9295e870b927f90f542cd716b60fe0c2b04cb8" docs/runs.geojson trail')
  console.error('\nWhere:')
  console.error('  - db-resort-id: Your resort UUID from Supabase (get it from resorts table)')
  console.error('  - openskimap-resort-id: The OpenSkiMap ID from ski-area.json (e.g., 4e9295e870b927f90f542cd716b60fe0c2b04cb8)')
  console.error('  - geojson-file: Path to lifts.geojson or runs.geojson')
  console.error('  - feature-type: Optional - "trail", "lift", "boundary", or "area" (auto-detected if not provided)')
  process.exit(1)
}

const [dbResortId, openSkiMapResortId, filePath, featureType] = args

if (!fs.existsSync(filePath)) {
  console.error(`Error: File not found: ${filePath}`)
  process.exit(1)
}

const validFeatureTypes: Array<'trail' | 'lift' | 'boundary' | 'area'> = ['trail', 'lift', 'boundary', 'area']
if (featureType && !validFeatureTypes.includes(featureType as any)) {
  console.error(`Error: Invalid feature type. Must be one of: ${validFeatureTypes.join(', ')}`)
  process.exit(1)
}

importGeoJSON(dbResortId, filePath, openSkiMapResortId, featureType as any).catch((error) => {
  console.error('Fatal error:', error)
  process.exit(1)
})

