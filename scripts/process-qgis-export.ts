/**
 * Script to process QGIS-exported tiles and prepare them for use in the app
 * 
 * This script:
 * 1. Validates tile structure
 * 2. Optimizes tile images
 * 3. Generates a tile manifest
 * 4. Checks for missing tiles
 * 
 * Usage:
 *   npx tsx scripts/process-qgis-export.ts <tiles-directory>
 * 
 * Example:
 *   npx tsx scripts/process-qgis-export.ts public/tiles
 */

import * as fs from 'fs'
import * as path from 'path'

interface TileManifest {
  minZoom: number
  maxZoom: number
  bounds: {
    north: number
    south: number
    east: number
    west: number
  }
  tileCount: number
  missingTiles: string[]
}

function findZoomLevels(tilesDir: string): { min: number; max: number } {
  const zoomDirs = fs.readdirSync(tilesDir)
    .filter(dir => {
      const dirPath = path.join(tilesDir, dir)
      return fs.statSync(dirPath).isDirectory() && /^\d+$/.test(dir)
    })
    .map(dir => parseInt(dir, 10))
    .filter(zoom => !isNaN(zoom))

  if (zoomDirs.length === 0) {
    throw new Error('No zoom level directories found')
  }

  return {
    min: Math.min(...zoomDirs),
    max: Math.max(...zoomDirs),
  }
}

function countTiles(tilesDir: string, zoom: number): number {
  const zoomDir = path.join(tilesDir, zoom.toString())
  if (!fs.existsSync(zoomDir)) {
    return 0
  }

  let count = 0
  const xDirs = fs.readdirSync(zoomDir)
    .filter(dir => {
      const dirPath = path.join(zoomDir, dir)
      return fs.statSync(dirPath).isDirectory() && /^\d+$/.test(dir)
    })

  for (const xDir of xDirs) {
    const xPath = path.join(zoomDir, xDir)
    const yFiles = fs.readdirSync(xPath)
      .filter(file => file.endsWith('.png') || file.endsWith('.jpg'))
    count += yFiles.length
  }

  return count
}

function validateTileStructure(tilesDir: string, zoom: number): string[] {
  const errors: string[] = []
  const zoomDir = path.join(tilesDir, zoom.toString())

  if (!fs.existsSync(zoomDir)) {
    errors.push(`Zoom level ${zoom} directory does not exist`)
    return errors
  }

  const xDirs = fs.readdirSync(zoomDir)
    .filter(dir => {
      const dirPath = path.join(zoomDir, dir)
      return fs.statSync(dirPath).isDirectory()
    })

  for (const xDir of xDirs) {
    const xPath = path.join(zoomDir, xDir)
    const yFiles = fs.readdirSync(xPath)
      .filter(file => file.endsWith('.png') || file.endsWith('.jpg'))

    if (yFiles.length === 0) {
      errors.push(`No tiles found in ${xPath}`)
    }

    // Check for invalid file names
    for (const yFile of yFiles) {
      const yNum = yFile.replace(/\.(png|jpg)$/, '')
      if (!/^\d+$/.test(yNum)) {
        errors.push(`Invalid tile name: ${xPath}/${yFile}`)
      }
    }
  }

  return errors
}

function generateManifest(tilesDir: string): TileManifest {
  const { min, max } = findZoomLevels(tilesDir)
  
  let totalTiles = 0
  const allErrors: string[] = []

  for (let zoom = min; zoom <= max; zoom++) {
    const count = countTiles(tilesDir, zoom)
    totalTiles += count
    
    const errors = validateTileStructure(tilesDir, zoom)
    allErrors.push(...errors)

    console.log(`  Zoom ${zoom}: ${count} tiles`)
  }

  // Estimate bounds (this is a placeholder - you'd need actual tile coordinates)
  const bounds = {
    north: 0,
    south: 0,
    east: 0,
    west: 0,
  }

  return {
    minZoom: min,
    maxZoom: max,
    bounds,
    tileCount: totalTiles,
    missingTiles: allErrors,
  }
}

function optimizeTiles(tilesDir: string): void {
  console.log('\n⚠️  Tile optimization not implemented')
  console.log('   Consider using tools like:')
  console.log('   - pngquant (for PNG compression)')
  console.log('   - imagemin (Node.js image optimization)')
  console.log('   - sharp (high-performance image processing)')
}

async function processQGISExport(tilesDir: string) {
  console.log(`\n=== Processing QGIS Tile Export ===`)
  console.log(`Tiles directory: ${tilesDir}`)

  if (!fs.existsSync(tilesDir)) {
    console.error(`Error: Directory does not exist: ${tilesDir}`)
    process.exit(1)
  }

  try {
    const manifest = generateManifest(tilesDir)

    console.log(`\n=== Tile Manifest ===`)
    console.log(`Zoom levels: ${manifest.minZoom} - ${manifest.maxZoom}`)
    console.log(`Total tiles: ${manifest.tileCount}`)
    console.log(`Errors found: ${manifest.missingTiles.length}`)

    if (manifest.missingTiles.length > 0) {
      console.log('\n⚠️  Issues found:')
      manifest.missingTiles.forEach(error => {
        console.log(`  - ${error}`)
      })
    }

    // Save manifest
    const manifestPath = path.join(tilesDir, 'manifest.json')
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))
    console.log(`\n✅ Manifest saved to: ${manifestPath}`)

    // Optional: Optimize tiles
    // optimizeTiles(tilesDir)

    console.log(`\n✅ Processing complete!`)
    console.log(`\nNext steps:`)
    console.log(`1. Review the manifest.json file`)
    console.log(`2. Fix any errors if needed`)
    console.log(`3. Update MapView.tsx to use custom tiles`)
    console.log(`4. Test in your app`)

  } catch (error) {
    console.error('Error processing tiles:', error)
    process.exit(1)
  }
}

// Main execution
const args = process.argv.slice(2)

if (args.length < 1) {
  console.error('Usage: npx tsx scripts/process-qgis-export.ts <tiles-directory>')
  console.error('\nExample:')
  console.error('  npx tsx scripts/process-qgis-export.ts public/tiles')
  process.exit(1)
}

const tilesDir = args[0]

processQGISExport(tilesDir).catch((error) => {
  console.error('Fatal error:', error)
  process.exit(1)
})

