/**
 * Script to fix Supabase GeoJSON export format
 * 
 * Supabase exports GeoJSON wrapped in an array with jsonb_build_object key.
 * This script extracts the actual FeatureCollection and creates a valid GeoJSON file.
 * 
 * Usage:
 *   npx tsx scripts/fix-supabase-geojson.ts <input-file> [output-file]
 * 
 * Example:
 *   npx tsx scripts/fix-supabase-geojson.ts supaExp.json supaExp-fixed.json
 */

import * as fs from 'fs'
import * as path from 'path'

interface SupabaseExport {
  jsonb_build_object?: {
    type: 'FeatureCollection'
    features: any[]
  }
}

function fixGeoJSON(inputPath: string, outputPath?: string): void {
  console.log(`\n=== Fixing Supabase GeoJSON Export ===`)
  console.log(`Input file: ${inputPath}`)

  if (!fs.existsSync(inputPath)) {
    console.error(`Error: File not found: ${inputPath}`)
    process.exit(1)
  }

  // Read the file
  const fileContent = fs.readFileSync(inputPath, 'utf-8')
  let data: any

  try {
    data = JSON.parse(fileContent)
  } catch (error) {
    console.error('Error: Invalid JSON file')
    console.error(error)
    process.exit(1)
  }

  // Check if it's already valid GeoJSON
  if (data.type === 'FeatureCollection' && Array.isArray(data.features)) {
    console.log('✅ File is already valid GeoJSON!')
    if (outputPath && outputPath !== inputPath) {
      fs.writeFileSync(outputPath, JSON.stringify(data, null, 2))
      console.log(`✅ Copied to: ${outputPath}`)
    }
    return
  }

  // Check if it's the Supabase export format (array with jsonb_build_object)
  if (Array.isArray(data) && data.length > 0) {
    const firstItem = data[0] as SupabaseExport
    
    if (firstItem.jsonb_build_object) {
      console.log('📦 Detected Supabase export format (jsonb_build_object)')
      const featureCollection = firstItem.jsonb_build_object
      
      if (featureCollection.type === 'FeatureCollection' && Array.isArray(featureCollection.features)) {
        console.log(`✅ Found FeatureCollection with ${featureCollection.features.length} features`)
        
        // Create output path
        const output = outputPath || inputPath.replace(/\.json$/, '-fixed.json')
        
        // Write fixed GeoJSON
        fs.writeFileSync(output, JSON.stringify(featureCollection, null, 2))
        console.log(`✅ Fixed GeoJSON saved to: ${output}`)
        console.log(`\nYou can now import this file into QGIS!`)
        return
      }
    }
  }

  // Try to find FeatureCollection anywhere in the structure
  function findFeatureCollection(obj: any): any {
    if (obj && typeof obj === 'object') {
      if (obj.type === 'FeatureCollection' && Array.isArray(obj.features)) {
        return obj
      }
      
      // Recursively search
      for (const key in obj) {
        const found = findFeatureCollection(obj[key])
        if (found) return found
      }
    }
    return null
  }

  const featureCollection = findFeatureCollection(data)
  if (featureCollection) {
    console.log('📦 Found FeatureCollection in nested structure')
    console.log(`✅ Found FeatureCollection with ${featureCollection.features.length} features`)
    
    const output = outputPath || inputPath.replace(/\.json$/, '-fixed.json')
    fs.writeFileSync(output, JSON.stringify(featureCollection, null, 2))
    console.log(`✅ Fixed GeoJSON saved to: ${output}`)
    console.log(`\nYou can now import this file into QGIS!`)
    return
  }

  // If we get here, we couldn't fix it
  console.error('❌ Error: Could not find FeatureCollection in the file')
  console.error('The file structure is:')
  console.error(JSON.stringify(data, null, 2).substring(0, 500))
  process.exit(1)
}

// Main execution
const args = process.argv.slice(2)

if (args.length < 1) {
  console.error('Usage: npx tsx scripts/fix-supabase-geojson.ts <input-file> [output-file]')
  console.error('\nExample:')
  console.error('  npx tsx scripts/fix-supabase-geojson.ts supaExp.json supaExp-fixed.json')
  process.exit(1)
}

const inputPath = args[0]
const outputPath = args[1]

fixGeoJSON(inputPath, outputPath)

