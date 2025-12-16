# Filtering and Importing from Large OpenSkiMap Files

The `lifts.geojson` and `runs.geojson` files contain **all resorts** from OpenSkiMap. This guide shows you how to filter for your specific resort and import only those features.

## The Two IDs Explained

1. **OpenSkiMap Resort ID**: The ID from OpenSkiMap (e.g., `4e9295e870b927f90f542cd716b60fe0c2b04cb8` for Big White)
   - Found in `docs/ski-area.json` in the `properties.id` field
   - Used to filter features from the large files

2. **Database Resort ID**: Your resort's UUID in your Supabase database (e.g., `2719c1b8-49d7-474a-8d35-59cf9e70331b`)
   - Get it from: Supabase Dashboard → Table Editor → `resorts` table
   - Used to link imported features to your resort

## Quick Start

### Step 1: Get Your IDs

**OpenSkiMap ID** (from `docs/ski-area.json`):
- Already have it! It's `4e9295e870b927f90f542cd716b60fe0c2b04cb8` for Big White

**Database Resort ID**:
```sql
SELECT id, name, slug FROM resorts WHERE slug = 'your-resort-slug';
```

### Step 2: Import Lifts

```bash
npx tsx scripts/filter-and-import-ski-features.ts "6f35790a-b42a-4754-a101-3a8b5764e439" "53eb896b4026759b023a4bae550df280bd0c4fdb" docs/lifts.geojson lift
```

### Step 3: Import Runs/Trails

```bash
npx tsx scripts/filter-and-import-ski-features.ts "2719c1b8-49d7-474a-8d35-59cf9e70331b" "4e9295e870b927f90f542cd716b60fe0c2b04cb8" docs/runs.geojson trail
```

## Complete Example for Big White

```bash
# Replace "your-db-resort-uuid" with your actual UUID from Supabase

# Import boundary (already done if you imported ski-area.json)
npx tsx scripts/import-ski-features.ts "your-db-resort-uuid" docs/ski-area.json boundary

# Import lifts
npx tsx scripts/filter-and-import-ski-features.ts "your-db-resort-uuid" "4e9295e870b927f90f542cd716b60fe0c2b04cb8" docs/lifts.geojson lift

# Import runs
npx tsx scripts/filter-and-import-ski-features.ts "your-db-resort-uuid" "4e9295e870b927f90f542cd716b60fe0c2b04cb8" docs/runs.geojson trail
```

## How It Works

1. **Filtering**: The script reads the large GeoJSON file and filters features where:
   - The feature has a `skiAreas` array containing your OpenSkiMap ID, OR
   - The feature itself matches your OpenSkiMap ID (for boundary areas)

2. **Streaming**: For very large files (>10MB), it uses streaming to avoid loading everything into memory

3. **Importing**: Filters first, then imports only the matching features to your database

## What Gets Filtered

The script looks for features where:
```json
{
  "properties": {
    "skiAreas": [
      {
        "properties": {
          "id": "4e9295e870b927f90f542cd716b60fe0c2b04cb8"  // ← Must match
        }
      }
    ]
  }
}
```

## Finding OpenSkiMap IDs for Other Resorts

If you want to add a different resort later:

1. Download their ski-area JSON:
   ```bash
   curl "https://api.openskimap.org/ski-areas/{ski-area-id}.geojson" > docs/other-resort-area.json
   ```

2. Open the file and find the `id` in `properties.id`

3. Use that ID to filter their features from the large files

## Troubleshooting

**"No features found for this resort!"**
- Double-check the OpenSkiMap ID matches the one in `ski-area.json`
- Verify the file contains features for that resort
- Check that the file format is correct (valid GeoJSON)

**Script is slow:**
- Large files (>10MB) use streaming - this is normal
- The progress indicator shows how many features have been processed
- Be patient, it will complete!

**Memory errors:**
- The script automatically uses streaming for large files
- If you still have issues, the file might be corrupted or have invalid JSON

## Tips

- The OpenSkiMap ID never changes - you only need to find it once
- Save both IDs somewhere for future reference:
  ```
  Big White Ski Resort:
    - OpenSkiMap ID: 4e9295e870b927f90f542cd716b60fe0c2b04cb8
    - Database ID: your-uuid-here
  ```
- Import lifts first, then runs (easier to verify on the map)

