/**
 * Script to check ski features in the database
 * 
 * Usage:
 *   npx tsx scripts/check-ski-features.ts <resort-id>
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
  console.error('Make sure NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or NEXT_PUBLIC_SUPABASE_ANON_KEY) are set')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)

async function checkSkiFeatures(resortId: string) {
  console.log(`\n=== Checking Ski Features for Resort: ${resortId} ===\n`)

  // Get all features for this resort
  const { data: features, error } = await supabase
    .from('ski_features')
    .select('id, name, type, difficulty, status, active, resort_id, geometry')
    .eq('resort_id', resortId)

  if (error) {
    console.error('❌ Error querying ski_features:', error)
    process.exit(1)
  }

  if (!features || features.length === 0) {
    console.log('❌ No ski features found for this resort!')
    console.log('\nPossible issues:')
    console.log('  1. The resort_id might be incorrect')
    console.log('  2. The features might not have been imported yet')
    console.log('  3. The features might be in a different resort')
    process.exit(1)
  }

  console.log(`✅ Found ${features.length} total features\n`)

  // Group by type
  const byType = features.reduce((acc, f) => {
    acc[f.type] = (acc[f.type] || 0) + 1
    return acc
  }, {} as Record<string, number>)

  console.log('Features by type:')
  Object.entries(byType).forEach(([type, count]) => {
    console.log(`  ${type}: ${count}`)
  })

  // Check active status
  const activeCount = features.filter(f => f.active).length
  const inactiveCount = features.filter(f => !f.active).length
  console.log(`\nActive: ${activeCount}, Inactive: ${inactiveCount}`)

  // Check geometry validity
  console.log('\nChecking geometry validity...')
  let validGeometry = 0
  let invalidGeometry = 0
  const geometryIssues: string[] = []

  features.forEach((feature) => {
    try {
      if (!feature.geometry) {
        invalidGeometry++
        geometryIssues.push(`${feature.name || feature.id}: Missing geometry`)
        return
      }

      const geom = feature.geometry
      if (!geom.type) {
        invalidGeometry++
        geometryIssues.push(`${feature.name || feature.id}: Missing geometry.type`)
        return
      }

      if (!geom.coordinates) {
        invalidGeometry++
        geometryIssues.push(`${feature.name || feature.id}: Missing geometry.coordinates`)
        return
      }

      // Check coordinate structure
      if (geom.type === 'LineString' && !Array.isArray(geom.coordinates[0])) {
        invalidGeometry++
        geometryIssues.push(`${feature.name || feature.id}: Invalid LineString coordinates`)
        return
      }

      if (geom.type === 'MultiLineString' && !Array.isArray(geom.coordinates[0]?.[0])) {
        invalidGeometry++
        geometryIssues.push(`${feature.name || feature.id}: Invalid MultiLineString coordinates`)
        return
      }

      validGeometry++
    } catch (e) {
      invalidGeometry++
      geometryIssues.push(`${feature.name || feature.id}: ${e}`)
    }
  })

  console.log(`  Valid: ${validGeometry}, Invalid: ${invalidGeometry}`)
  if (geometryIssues.length > 0 && geometryIssues.length <= 10) {
    console.log('\n  Geometry issues:')
    geometryIssues.forEach(issue => console.log(`    - ${issue}`))
  } else if (geometryIssues.length > 10) {
    console.log(`\n  Geometry issues: ${geometryIssues.length} (showing first 10)`)
    geometryIssues.slice(0, 10).forEach(issue => console.log(`    - ${issue}`))
  }

  // Show sample features
  console.log('\n\nSample features (first 5):')
  features.slice(0, 5).forEach((feature, i) => {
    console.log(`\n  ${i + 1}. ${feature.name || 'Unnamed'}`)
    console.log(`     Type: ${feature.type}`)
    console.log(`     Difficulty: ${feature.difficulty || 'N/A'}`)
    console.log(`     Status: ${feature.status || 'N/A'}`)
    console.log(`     Active: ${feature.active}`)
    console.log(`     Geometry type: ${feature.geometry?.type || 'MISSING'}`)
    if (feature.geometry?.coordinates) {
      const coords = feature.geometry.coordinates
      if (Array.isArray(coords[0])) {
        console.log(`     Coordinates: ${coords.length} points`)
      } else {
        console.log(`     Coordinates: ${coords.length} coordinate pairs`)
      }
    }
  })

  // Test the query that the page uses
  console.log('\n\n=== Testing Page Query ===')
  const { data: pageFeatures, error: pageError } = await supabase
    .from('ski_features')
    .select('id, name, type, difficulty, geometry, status')
    .eq('resort_id', resortId)
    .eq('active', true)
    .order('order_index', { ascending: true })

  if (pageError) {
    console.error('❌ Error with page query:', pageError)
  } else {
    console.log(`✅ Page query returned ${pageFeatures?.length || 0} features`)
    if (pageFeatures && pageFeatures.length > 0) {
      console.log(`   Types: ${[...new Set(pageFeatures.map(f => f.type))].join(', ')}`)
    }
  }

  console.log('\n=== Summary ===')
  console.log(`Total features: ${features.length}`)
  console.log(`Active features: ${activeCount}`)
  console.log(`Features returned by page query: ${pageFeatures?.length || 0}`)
  
  if (activeCount > 0 && (pageFeatures?.length || 0) === 0) {
    console.log('\n⚠️  WARNING: You have active features but the page query returns none!')
    console.log('   This might be an RLS (Row Level Security) issue.')
  }
}

// Main execution
const args = process.argv.slice(2)

if (args.length < 1) {
  console.error('Usage: npx tsx scripts/check-ski-features.ts <resort-id>')
  console.error('\nExample:')
  console.error('  npx tsx scripts/check-ski-features.ts "6f35790a-b42a-4754-a101-3a8b5764e439"')
  process.exit(1)
}

const resortId = args[0]

checkSkiFeatures(resortId).catch((error) => {
  console.error('Fatal error:', error)
  process.exit(1)
})

