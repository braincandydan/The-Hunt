# Importing OpenSkiMap Data

This guide shows you how to import ski area data from OpenSkiMap into your database.

## Getting Your Resort ID ⚠️ IMPORTANT

You need your **resort's UUID from your Supabase database**, NOT the OpenSkiMap ID in the JSON files!

**The OpenSkiMap ID** (like `4e9295e870b927f90f542cd716b60fe0c2b04cb8`) is just metadata - that's NOT your resort ID.

**Get your actual resort UUID:**

**Option A: Supabase Dashboard (Easiest)**
1. Go to Supabase Dashboard → Table Editor → `resorts` table
2. Find your resort row
3. Copy the `id` value (UUID like `123e4567-e89b-12d3-a456-426614174000`)

**Option B: SQL Editor**
```sql
SELECT id, name, slug FROM resorts WHERE slug = 'your-resort-slug';
```

Copy the `id` (UUID) - that's what you'll use in the import command.

## Getting OpenSkiMap Data

### Method 1: OpenSkiMap API

OpenSkiMap provides an API to download ski area data:

```bash
# Get ski area boundary
curl "https://api.openskimap.org/ski-areas/{ski-area-id}.geojson" > docs/ski-area.json

curl "https://api.openskimap.org/ski-areas/4e9295e870b927f90f542cd716b60fe0c2b04cb8.geojson" > docs/ski-area.json

# Get ski runs
curl "https://api.openskimap.org/ski-areas/{ski-area-id}/runs.geojson" > docs/ski-runs.json

curl "https://api.openskimap.org/ski-areas/4e9295e870b927f90f542cd716b60fe0c2b04cb8/runs.geojson" > docs/ski-runs.json

# Get lifts
curl "https://api.openskimap.org/ski-areas/{ski-area-id}/lifts.geojson" > docs/ski-lifts.json

curl "https://api.openskimap.org/ski-areas/4e9295e870b927f90f542cd716b60fe0c2b04cb8/lifts.geojson" > docs/ski-lifts.json
```

### Method 2: OpenSkiMap Website

1. Go to https://www.openskimap.org/
2. Search for your ski resort
3. Navigate to the resort page
4. Look for download/export options or use the API endpoints shown above

## Installing Dependencies

The import script uses `tsx` to run TypeScript directly:

```bash
npm install --save-dev tsx
```

This should already be installed if you've run the previous setup.

## Importing the Data

### 1. Import Ski Area Boundary

The boundary polygon defines the overall ski area:

```bash
npx tsx scripts/import-ski-features.ts "your-resort-uuid" docs/ski-area.json area
```

### 2. Import Ski Runs

Import all the ski trails/runs:

```bash
npx tsx scripts/import-ski-features.ts "your-resort-uuid" docs/ski-runs.json trail
```

The script will automatically:
- Extract trail names
- Map difficulty levels (novice/easy → green, intermediate → blue, advanced/expert → black)
- Preserve trail geometry

### 3. Import Lifts

Import chairlifts, gondolas, and other lifts:

```bash
npx tsx scripts/import-ski-features.ts "your-resort-uuid" docs/ski-lifts.json lift
```

## Environment Variables

Make sure your `.env.local` has:

```env
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
```

Or if you have a service role key (for admin operations):

```env
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

## Complete Example

Here's a complete workflow for importing Big White Ski Resort data:

```bash
# 1. Find your resort ID
# (Check Supabase dashboard or run SQL query)

# 2. Download OpenSkiMap data
curl "https://api.openskimap.org/ski-areas/4e9295e870b927f90f542cd716b60fe0c2b04cb8.geojson" > docs/ski-area.json
curl "https://api.openskimap.org/ski-areas/4e9295e870b927f90f542cd716b60fe0c2b04cb8/runs.geojson" > docs/ski-runs.json
curl "https://api.openskimap.org/ski-areas/4e9295e870b927f90f542cd716b60fe0c2b04cb8/lifts.geojson" > docs/ski-lifts.json

# 3. Import boundary
npx tsx scripts/import-ski-features.ts "your-resort-uuid" docs/ski-area.json area

# 4. Import runs
npx tsx scripts/import-ski-features.ts "your-resort-uuid" docs/ski-runs.json trail

# 5. Import lifts
npx tsx scripts/import-ski-features.ts "your-resort-uuid" docs/ski-lifts.json lift
```

## Verifying the Import

Check your imported features in Supabase:

```sql
SELECT 
  name, 
  type, 
  difficulty, 
  status, 
  active 
FROM ski_features 
WHERE resort_id = 'your-resort-uuid'
ORDER BY type, name;
```

Or view them on the map at:
`/[resort-slug]/game/map`

## Troubleshooting

**"Missing Supabase credentials" error:**
- Make sure `.env.local` exists and has the correct variables
- Restart your terminal after creating `.env.local`

**"Feature type" errors:**
- Make sure you specify the correct type: `trail`, `lift`, `boundary`, or `area`
- The script will try to auto-detect, but specifying it helps

**Duplicate features:**
- The script will insert new features each time you run it
- Delete existing features first if you want to re-import:
  ```sql
  DELETE FROM ski_features WHERE resort_id = 'your-resort-uuid';
  ```

**Geometry errors:**
- Verify your GeoJSON file is valid
- Check that coordinates are in `[longitude, latitude]` format
- Validate GeoJSON at https://geojson.io/

## Next Steps

After importing:
1. Visit the map page to see your features
2. Customize styling if needed (difficulty colors, etc.)
3. Add or edit features manually via SQL if needed
4. Consider adding an admin UI for managing features in the future

## Notes

- The script preserves all original OpenSkiMap properties in the `metadata` field
- Difficulty mapping follows North American conventions (green/blue/black)
- Features are set to `active = true` by default
- The script processes features in batches for better performance

