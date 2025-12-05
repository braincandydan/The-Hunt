/**
 * Script to import OpenSkiMap GeoJSON data into the database
 * 
 * Usage:
 *   npx tsx scripts/import-ski-features.ts <resort-id> <geojson-file> [feature-type]
 * 
 * Example:
 *   npx tsx scripts/import-ski-features.ts "uuid-here" docs/ski-area.json boundary
 *   npx tsx scripts/import-ski-features.ts "uuid-here" docs/ski-runs.json trail
 *   npx tsx scripts/import-ski-features.ts "uuid-here" docs/ski-lifts.json lift
 */

import { createClient } from '@supabase/supabase-js'
import * as fs from 'fs'
import * as path from 'path'
import { config } from 'dotenv'

// Load environment variables from .env.local
config({ path: '.env.local' })

// Load environment variables
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
// Prefer service role key (bypasses RLS) for admin scripts
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseKey) {
  console.error('Error: Missing Supabase credentials')
  console.error('\nTo run this script, you need one of:')
  console.error('1. SUPABASE_SERVICE_ROLE_KEY (recommended - bypasses RLS)')
  console.error('   OR')
  console.error('2. NEXT_PUBLIC_SUPABASE_ANON_KEY (requires RLS policies to allow inserts)')
  console.error('\nAdd one of these to your .env.local file')
  console.error('\nTo get your Service Role Key:')
  console.error('  1. Go to Supabase Dashboard → Settings → API')
  console.error('  2. Copy the "service_role" key (keep this secret!)')
  console.error('  3. Add to .env.local: SUPABASE_SERVICE_ROLE_KEY=your_service_role_key')
  process.exit(1)
}

if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.warn('\n⚠️  Warning: Using anon key. If you get RLS errors, use SUPABASE_SERVICE_ROLE_KEY instead.\n')
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

function mapOpenSkiMapToFeatureType(properties: any): 'trail' | 'lift' | 'boundary' | 'area' {
  // OpenSkiMap uses different property names
  if (properties.type === 'skiArea' || properties.type === 'area') {
    return 'area'
  }
  if (properties.piste_type === 'downhill' || properties.piste_type === 'nordic') {
    return 'trail'
  }
  if (properties.aerialway || properties.aerialway_type) {
    return 'lift'
  }
  if (properties.boundary || properties.type === 'boundary') {
    return 'boundary'
  }
  
  // Default to area for ski areas
  return 'area'
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

async function importGeoJSON(resortId: string, filePath: string, featureType?: 'trail' | 'lift' | 'boundary' | 'area') {
  console.log(`Reading GeoJSON from: ${filePath}`)
  
  const fileContent = fs.readFileSync(filePath, 'utf-8')
  const geoJson: GeoJSONFeatureCollection = JSON.parse(fileContent)
  
  if (geoJson.type !== 'FeatureCollection') {
    console.error('Error: Expected FeatureCollection')
    process.exit(1)
  }
  
  console.log(`Found ${geoJson.features.length} features`)
  
  const features = []
  
  for (const feature of geoJson.features) {
    // Determine feature type
    let type: 'trail' | 'lift' | 'boundary' | 'area' = featureType || mapOpenSkiMapToFeatureType(feature.properties)
    
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
    }
    
    // Create database record
    const dbFeature = {
      resort_id: resortId,
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
    console.log(`  - Prepared: ${name} (${type}${difficulty ? `, ${difficulty}` : ''})`)
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
      console.error(`Error inserting batch ${Math.floor(i / batchSize) + 1}:`, error)
      process.exit(1)
    }
    
    console.log(`  ✓ Inserted batch ${Math.floor(i / batchSize) + 1} (${batch.length} features)`)
  }
  
  console.log(`\n✅ Successfully imported ${features.length} features!`)
}

// Main execution
const args = process.argv.slice(2)

if (args.length < 2) {
  console.error('Usage: npx tsx scripts/import-ski-features.ts <resort-id> <geojson-file> [feature-type]')
  console.error('\nExample:')
  console.error('  npx tsx scripts/import-ski-features.ts "uuid-here" docs/ski-area.json boundary')
  console.error('  npx tsx scripts/import-ski-features.ts "uuid-here" docs/ski-runs.json trail')
  console.error('  npx tsx scripts/import-ski-features.ts "uuid-here" docs/ski-lifts.json lift')
  process.exit(1)
}

const [resortId, filePath, featureType] = args

if (!fs.existsSync(filePath)) {
  console.error(`Error: File not found: ${filePath}`)
  process.exit(1)
}

const validFeatureTypes: Array<'trail' | 'lift' | 'boundary' | 'area'> = ['trail', 'lift', 'boundary', 'area']
if (featureType && !validFeatureTypes.includes(featureType as any)) {
  console.error(`Error: Invalid feature type. Must be one of: ${validFeatureTypes.join(', ')}`)
  process.exit(1)
}

importGeoJSON(resortId, filePath, featureType as any).catch((error) => {
  console.error('Fatal error:', error)
  process.exit(1)
})

