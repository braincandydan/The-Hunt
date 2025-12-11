# Importing from ski_areas.geojson

The `ski_areas.geojson` file contains **all ski resorts** from OpenSkiMap. You can use the same filtering script to import a specific resort's boundary.

## What's Different?

Unlike `lifts.geojson` and `runs.geojson` which contain features that **belong to** resorts, `ski_areas.geojson` contains the **resort boundaries themselves**.

Each feature in this file:
- **IS** a ski area/resort (not a feature that belongs to one)
- Has `properties.id` matching the OpenSkiMap ID
- Has `properties.type === 'skiArea'`
- Typically has `Point` or `Polygon` geometry

## Importing a Resort Boundary

To import Big White's boundary from `ski_areas.geojson`:

```bash
npx tsx scripts/filter-and-import-ski-features.ts "your-db-resort-uuid" "4e9295e870b927f90f542cd716b60fe0c2b04cb8" docs/ski_areas.geojson boundary
```

The script will:
1. Find the feature where `properties.id` matches the OpenSkiMap ID
2. Import it as a `boundary` type (if Polygon) or `area` type (if Point)
3. Link it to your database resort ID

## Geometry Types

- **Polygon/MultiPolygon**: Imported as `boundary` - shows the resort boundary on the map
- **Point**: Imported as `area` - shows a marker at the resort center

Most resorts in `ski_areas.geojson` have Point geometry (just the center location), not full boundaries. If you want full boundaries, use the individual `ski-area.json` files you download per resort.

## Finding Other Resorts

To find a resort's OpenSkiMap ID from `ski_areas.geojson`:

```bash
# Search for a resort by name (case-insensitive)
grep -i "resort name" docs/ski_areas.geojson | head -1
```

Or search in the file:
1. Open `docs/ski_areas.geojson`
2. Search for the resort name (e.g., "Big White")
3. Find the `"id"` field in that feature's `properties`

## Example: Importing Multiple Resorts

If you want to import boundaries for multiple resorts, you'd run the script multiple times:

```bash
# Import Big White
npx tsx scripts/filter-and-import-ski-features.ts "big-white-uuid" "4e9295e870b927f90f542cd716b60fe0c2b04cb8" docs/ski_areas.geojson boundary

# Import another resort (replace IDs)
npx tsx scripts/filter-and-import-ski-features.ts "other-resort-uuid" "other-openskimap-id" docs/ski_areas.geojson boundary
```

## When to Use This

- ✅ Use `ski_areas.geojson` if you want quick center points for many resorts
- ✅ Good for importing basic resort locations
- ❌ Use individual `ski-area.json` files if you need full Polygon boundaries
- ❌ Use `lifts.geojson` / `runs.geojson` for detailed trail/lift data

## Note

Most features in `ski_areas.geojson` are Point geometries (just center coordinates), not full boundaries. For detailed boundaries, download individual resort files from OpenSkiMap API.

