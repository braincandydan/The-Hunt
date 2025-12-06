/**
 * Script to import filtered roads GeoJSON data into the database
 * 
 * Usage:
 *   npx tsx scripts/import-roads.ts <resort-id> <geojson-file>
 * 
 * Example:
 *   npx tsx scripts/import-roads.ts "a21399d1-2822-44eb-8109-48cd4888cd6d" RDCO_Roads_Filtered.geojson
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

async function importRoads(resortId: string, filePath: string) {
  console.log(`\n=== Importing Roads ===`)
  console.log(`Resort ID: ${resortId}`)
  console.log(`File: ${filePath}\n`)

  // Verify resort exists
  const { data: resort, error: resortError } = await supabase
    .from('resorts')
    .select('id, name')
    .eq('id', resortId)
    .single()

  if (resortError || !resort) {
    console.error(`Error: Resort not found with ID ${resortId}`)
    console.error(resortError?.message || 'Resort not found')
    process.exit(1)
  }

  console.log(`✓ Found resort: ${resort.name}`)

  // Read GeoJSON file
  const fullPath = path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath)
  
  if (!fs.existsSync(fullPath)) {
    console.error(`Error: File not found: ${fullPath}`)
    process.exit(1)
  }

  console.log(`Reading GeoJSON from: ${fullPath}`)
  const fileContent = fs.readFileSync(fullPath, 'utf-8')
  const geoJson: GeoJSONFeatureCollection = JSON.parse(fileContent)

  if (geoJson.type !== 'FeatureCollection') {
    console.error('Error: Expected FeatureCollection')
    process.exit(1)
  }

  console.log(`Found ${geoJson.features.length} road features\n`)

  const features = []

  for (const feature of geoJson.features) {
    // Extract road name from properties
    const name: string = feature.properties.ROADNAME || 
                         feature.properties.name || 
                         feature.properties.OBJECTID?.toString() || 
                         `Road ${features.length + 1}`

    // Prepare metadata (store original properties for reference)
    const metadata = {
      original_properties: feature.properties,
      source: 'rdco_roads',
      objectid: feature.properties.OBJECTID,
      streettype: feature.properties.STREETTYPE,
      shapelen: feature.properties.Shapelen,
    }

    // Create database record
    const dbFeature: any = {
      resort_id: resortId,
      name,
      type: 'road',
      difficulty: null, // Roads don't have difficulty
      geometry: feature.geometry,
      metadata,
      status: 'open', // Roads are always "open"
      active: true,
      order_index: features.length,
    }

    features.push(dbFeature)

    if (features.length <= 10 || features.length % 100 === 0) {
      console.log(`  - Prepared: ${name}`)
    }
  }

  if (features.length === 0) {
    console.error('No features to import')
    process.exit(1)
  }

  console.log(`\nImporting ${features.length} roads...`)

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

    console.log(`  ✓ Inserted batch ${Math.floor(i / batchSize) + 1} (${batch.length} roads)`)
  }

  console.log(`\n✅ Successfully imported ${features.length} roads!`)
}

// Main execution
const args = process.argv.slice(2)

if (args.length < 2) {
  console.error('Usage: npx tsx scripts/import-roads.ts <resort-id> <geojson-file>')
  console.error('\nExample:')
  console.error('  npx tsx scripts/import-roads.ts "a21399d1-2822-44eb-8109-48cd4888cd6d" RDCO_Roads_Filtered.geojson')
  process.exit(1)
}

const [resortId, filePath] = args

importRoads(resortId, filePath)
  .then(() => {
    console.log('\n✅ Done!')
    process.exit(0)
  })
  .catch((error) => {
    console.error('\n❌ Error:', error)
    process.exit(1)
  })

