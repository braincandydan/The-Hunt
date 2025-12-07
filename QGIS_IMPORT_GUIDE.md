# QGIS Import Guide: Fixing Supabase Exports

## The Problem

When you export GeoJSON from Supabase using `jsonb_build_object`, the result is wrapped in an array with a `jsonb_build_object` key. This is not valid GeoJSON and QGIS can't import it directly.

**Bad format (what Supabase exports):**
```json
[
  {
    "jsonb_build_object": {
      "type": "FeatureCollection",
      "features": [...]
    }
  }
]
```

**Good format (what QGIS needs):**
```json
{
  "type": "FeatureCollection",
  "features": [...]
}
```

## Solution 1: Use the Fix Script

I've created a script to fix the export:

```bash
npx tsx scripts/fix-supabase-geojson.ts supaExp.json supaExp-fixed.json
```

This will:
- Extract the FeatureCollection from the wrapped structure
- Create a valid GeoJSON file
- Save it as `supaExp-fixed.json`

## Solution 2: Better Supabase Export Query

Instead of using `jsonb_build_object`, use this query that exports proper GeoJSON directly:

```sql
-- Export ski features as proper GeoJSON
SELECT 
  jsonb_build_object(
    'type', 'FeatureCollection',
    'features', jsonb_agg(
      jsonb_build_object(
        'type', 'Feature',
        'geometry', geometry,
        'properties', jsonb_build_object(
          'id', id,
          'name', name,
          'type', type,
          'difficulty', difficulty,
          'status', status
        )
      )
    )
  ) as geojson
FROM ski_features
WHERE resort_id = 'your-resort-id' 
  AND active = true;
```

**Then in Supabase:**
1. Run the query
2. Click the download button (not copy)
3. Save as `.json` file
4. The file should be valid GeoJSON

## Solution 3: Export via Supabase API

You can also export via the API to get proper GeoJSON:

```typescript
// In a script or API route
const { data, error } = await supabase
  .from('ski_features')
  .select('id, name, type, difficulty, status, geometry')
  .eq('resort_id', resortId)
  .eq('active', true)

// Convert to GeoJSON
const geoJson = {
  type: 'FeatureCollection',
  features: data.map(feature => ({
    type: 'Feature',
    geometry: feature.geometry,
    properties: {
      id: feature.id,
      name: feature.name,
      type: feature.type,
      difficulty: feature.difficulty,
      status: feature.status,
    }
  }))
}

// Save to file
fs.writeFileSync('export.geojson', JSON.stringify(geoJson, null, 2))
```

## Importing into QGIS

### Step 1: Fix the File (if needed)

```bash
npx tsx scripts/fix-supabase-geojson.ts supaExp.json supaExp-fixed.json
```

### Step 2: Open QGIS

1. Open QGIS
2. Set CRS to **EPSG:4326** (WGS84):
   - `Project → Properties → CRS`
   - Search for "4326" or "WGS84"
   - Select "WGS 84 (EPSG:4326)"

### Step 3: Import the GeoJSON

**Method A: Drag and Drop**
1. Open your file manager
2. Drag `supaExp-fixed.json` into QGIS map canvas
3. QGIS will automatically detect it as GeoJSON

**Method B: Add Vector Layer**
1. `Layer → Add Layer → Add Vector Layer`
2. Click the `...` button
3. Navigate to `supaExp-fixed.json`
4. Click "Add"

**Method C: Browser Panel**
1. Open the Browser panel (if not visible: `View → Panels → Browser`)
2. Navigate to your file location
3. Right-click the file → "Add Layer to Project"

### Step 4: Verify Import

After importing, you should see:
- Features appear on the map
- Layer listed in the Layers panel
- Features visible in the attribute table

If you see a blue background but no features:
- **Check the CRS:** Make sure it's EPSG:4326
- **Zoom to layer:** Right-click layer → "Zoom to Layer"
- **Check extent:** The features might be outside the current view
- **Check data:** Open attribute table to verify features exist

### Step 5: Style the Features

1. Right-click the layer → "Properties" (or double-click)
2. Go to "Symbology" tab
3. Choose styling method:
   - **Categorized** - for different types (trail, lift, boundary)
   - **Single Symbol** - for uniform styling
   - **Rule-based** - for complex styling rules

**Example: Style by Type**
1. Select "Categorized"
2. Column: `type`
3. Click "Classify"
4. Set colors:
   - `trail` → Green
   - `lift` → Red
   - `boundary` → Black
   - `road` → Gray
5. Click "OK"

## Troubleshooting

### "No features found" or empty map

1. **Check file format:**
   ```bash
   # Verify it's valid GeoJSON
   cat supaExp-fixed.json | head -20
   ```
   Should start with `{` and contain `"type": "FeatureCollection"`

2. **Check CRS:**
   - QGIS: `Project → Properties → CRS` → EPSG:4326
   - Layer: Right-click layer → "Set Layer CRS" → EPSG:4326

3. **Zoom to extent:**
   - Right-click layer → "Zoom to Layer"
   - Or: `View → Zoom to Full Extent`

4. **Check coordinates:**
   - Open attribute table
   - Check if coordinates are reasonable (lat: -90 to 90, lng: -180 to 180)
   - Your coordinates look correct: ~49.7°N, ~118.9°W (British Columbia)

### "Invalid geometry" errors

1. Fix geometries in QGIS:
   - `Vector → Geometry Tools → Check Validity`
   - Fix any errors found

2. Or use the fix script before importing:
   ```bash
   npx tsx scripts/fix-supabase-geojson.ts supaExp.json supaExp-fixed.json
   ```

### Blue background (no features visible)

This usually means:
- ✅ QGIS is working (blue = background)
- ❌ Features aren't visible (wrong CRS, wrong zoom, or empty file)

**Fix:**
1. Right-click layer → "Zoom to Layer"
2. Check CRS matches (EPSG:4326)
3. Verify file has features (check file size, should be > 1KB)

## Next Steps

Once imported:
1. Style your features (see QGIS_INTEGRATION_GUIDE.md)
2. Create custom base maps
3. Export tiles for your app
4. Process and enhance data

## Quick Reference

```bash
# Fix Supabase export
npx tsx scripts/fix-supabase-geojson.ts input.json output.json

# Import into QGIS
# Drag & drop the fixed file, or use Add Vector Layer

# Verify in QGIS
# Right-click layer → Zoom to Layer
# Open attribute table to see features
```

