# Quick Import Guide - Using Your Existing JSON Files

## What the Script Does

The import script **reads from local GeoJSON files** you already have. It does NOT fetch from OpenSkiMap API automatically.

## Step-by-Step

### 1. You Already Have the Ski Area JSON! ✅

You have `docs/ski-area.json` which contains the Big White Ski Resort boundary. This is ready to use!

### 2. Get Your Resort ID ⚠️ IMPORTANT

You need your **resort's UUID from your database**, NOT the OpenSkiMap ID in the JSON file!

**Option A: Supabase Dashboard (Easiest)**
1. Go to Supabase Dashboard → Table Editor → `resorts` table
2. Find your resort row
3. Copy the `id` value (UUID like `123e4567-e89b-12d3-a456-426614174000`)

**Option B: SQL Editor**
```sql
SELECT id, name, slug FROM resorts;
```
Copy the `id` (UUID) for your resort.

**Note:** The ID in the JSON file (`4e9295e870b927f90f542cd716b60fe0c2b04cb8`) is the OpenSkiMap ID - that's NOT what you need!

### 3. Run the Import Script

**Open your terminal** (PowerShell on Windows) in the project directory (`D:\The Hunt`), then run:

```bash
npx tsx scripts/import-ski-features.ts "your-resort-uuid-here" docs/ski-area.json boundary
```

Replace `"your-resort-uuid-here"` with the actual UUID from step 2.

### 4. For Runs and Lifts (Optional)

If you want to add runs and lifts, you'll need to download those files first:

#### Option A: Download from OpenSkiMap API

In your terminal (PowerShell):

```powershell
# Download runs
curl -o docs/ski-runs.json "https://api.openskimap.org/ski-areas/4e9295e870b927f90f542cd716b60fe0c2b04cb8/runs.geojson"

# Download lifts
curl -o docs/ski-lifts.json "https://api.openskimap.org/ski-areas/4e9295e870b927f90f542cd716b60fe0c2b04cb8/lifts.geojson"
```

#### Option B: Download Manually

1. Visit: https://api.openskimap.org/ski-areas/4e9295e870b927f90f542cd716b60fe0c2b04cb8/runs.geojson
2. Save the JSON as `docs/ski-runs.json`
3. Repeat for lifts: https://api.openskimap.org/ski-areas/4e9295e870b927f90f542cd716b60fe0c2b04cb8/lifts.geojson
4. Save as `docs/ski-lifts.json`

Then import them:

```bash
npx tsx scripts/import-ski-features.ts "your-resort-uuid" docs/ski-runs.json trail
npx tsx scripts/import-ski-features.ts "your-resort-uuid" docs/ski-lifts.json lift
```

## Complete Example

Here's the exact workflow:

```powershell
# 1. Navigate to your project (if not already there)
cd "D:\The Hunt"

# 2. Check your .env.local has Supabase credentials
# (If not, the script will error and tell you)

# 3. Import the boundary (using your existing file)
npx tsx scripts/import-ski-features.ts "paste-your-resort-uuid-here" docs/ski-area.json boundary

# 4. (Optional) Download and import runs
curl -o docs/ski-runs.json "https://api.openskimap.org/ski-areas/4e9295e870b927f90f542cd716b60fe0c2b04cb8/runs.geojson"
npx tsx scripts/import-ski-features.ts "paste-your-resort-uuid-here" docs/ski-runs.json trail

# 5. (Optional) Download and import lifts
curl -o docs/ski-lifts.json "https://api.openskimap.org/ski-areas/4e9295e870b927f90f542cd716b60fe0c2b04cb8/lifts.geojson"
npx tsx scripts/import-ski-features.ts "paste-your-resort-uuid-here" docs/ski-lifts.json lift
```

## Where to Run It

- **Terminal/PowerShell**: In your project root directory (`D:\The Hunt`)
- **Command**: `npx tsx scripts/import-ski-features.ts ...`
- **Input**: Your local JSON files (like `docs/ski-area.json`)

## What Happens

1. Script reads your local JSON file
2. Parses the GeoJSON features
3. Converts to database format
4. Inserts into Supabase `ski_features` table
5. You see them on the map at `/[resort-slug]/game/map`

## Quick Test

To test with just the boundary you already have:

```bash
npx tsx scripts/import-ski-features.ts "your-resort-uuid" docs/ski-area.json boundary
```

That's it! The boundary will appear on your map.

