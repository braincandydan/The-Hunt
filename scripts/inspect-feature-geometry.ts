/**
 * Script to inspect the geometry of a specific feature
 * 
 * Usage:
 *   npx tsx scripts/inspect-feature-geometry.ts <resort-id> <feature-name>
 */

import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

// Load environment variables from .env.local
config({ path: '.env.local' })

// Load environment variables
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseKey) {
  console.error('Error: Missing Supabase credentials')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)

async function inspectFeature(resortId: string, featureName: string) {
  console.log(`\n=== Inspecting Feature: ${featureName} ===\n`)

  const { data: features, error } = await supabase
    .from('ski_features')
    .select('*')
    .eq('resort_id', resortId)
    .ilike('name', `%${featureName}%`)

  if (error) {
    console.error('❌ Error:', error)
    process.exit(1)
  }

  if (!features || features.length === 0) {
    console.log('❌ No features found')
    process.exit(1)
  }

  features.forEach((feature, i) => {
    console.log(`\n--- Feature ${i + 1}: ${feature.name} ---`)
    console.log(`Type: ${feature.type}`)
    console.log(`Difficulty: ${feature.difficulty || 'N/A'}`)
    console.log(`Status: ${feature.status || 'N/A'}`)
    console.log(`Active: ${feature.active}`)
    console.log(`\nGeometry:`)
    console.log(`  Type: ${feature.geometry?.type || 'MISSING'}`)
    
    if (feature.geometry?.coordinates) {
      const coords = feature.geometry.coordinates
      console.log(`  Coordinates structure:`)
      
      if (feature.geometry.type === 'LineString') {
        console.log(`    - LineString with ${coords.length} points`)
        if (coords.length > 0) {
          console.log(`    - First point: [${coords[0][0]}, ${coords[0][1]}]`)
          console.log(`    - Last point: [${coords[coords.length - 1][0]}, ${coords[coords.length - 1][1]}]`)
        }
      } else if (feature.geometry.type === 'MultiLineString') {
        console.log(`    - MultiLineString with ${coords.length} line segments`)
        coords.forEach((line: any[], idx: number) => {
          console.log(`      Line ${idx + 1}: ${line.length} points`)
        })
      } else if (feature.geometry.type === 'Polygon') {
        console.log(`    - Polygon with ${coords.length} rings`)
        if (coords.length > 0 && coords[0].length > 0) {
          console.log(`    - First ring: ${coords[0].length} points`)
          console.log(`    - First point: [${coords[0][0][0]}, ${coords[0][0][1]}]`)
        }
      } else if (feature.geometry.type === 'MultiPolygon') {
        console.log(`    - MultiPolygon with ${coords.length} polygons`)
      }
      
      // Check coordinate format (should be [lng, lat] for GeoJSON)
      if (coords.length > 0) {
        const firstCoord = feature.geometry.type === 'Polygon' 
          ? coords[0][0] 
          : feature.geometry.type === 'MultiLineString'
          ? coords[0][0]
          : coords[0]
        
        if (Array.isArray(firstCoord) && firstCoord.length >= 2) {
          const [x, y] = firstCoord
          console.log(`\n  Coordinate format check:`)
          console.log(`    First coordinate: [${x}, ${y}]`)
          
          // GeoJSON should be [lng, lat], so lng should be between -180 and 180
          // and lat should be between -90 and 90
          if (Math.abs(x) <= 180 && Math.abs(y) <= 90) {
            console.log(`    ✓ Valid GeoJSON format [lng, lat]`)
          } else if (Math.abs(y) <= 180 && Math.abs(x) <= 90) {
            console.log(`    ⚠️  Possibly swapped [lat, lng] instead of [lng, lat]`)
          } else {
            console.log(`    ⚠️  Coordinate values seem unusual`)
          }
        }
      }
    } else {
      console.log(`  ❌ No coordinates found`)
    }
    
    // Show full geometry JSON (truncated)
    console.log(`\n  Full geometry (first 500 chars):`)
    const geomStr = JSON.stringify(feature.geometry, null, 2)
    console.log(geomStr.substring(0, 500) + (geomStr.length > 500 ? '...' : ''))
  })
}

// Main execution
const args = process.argv.slice(2)

if (args.length < 2) {
  console.error('Usage: npx tsx scripts/inspect-feature-geometry.ts <resort-id> <feature-name>')
  console.error('\nExample:')
  console.error('  npx tsx scripts/inspect-feature-geometry.ts "6f35790a-b42a-4754-a101-3a8b5764e439" "Collateral"')
  process.exit(1)
}

const [resortId, featureName] = args

inspectFeature(resortId, featureName).catch((error) => {
  console.error('Fatal error:', error)
  process.exit(1)
})

