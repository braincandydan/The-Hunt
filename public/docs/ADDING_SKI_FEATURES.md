# Adding Ski Features to the Map

This guide explains how to add ski trails, lifts, and boundaries to your resort map.

## Overview

Ski features (trails, lifts, boundaries) are stored in the `ski_features` table as GeoJSON geometry. The map will automatically display them with appropriate styling based on type and difficulty.

## Database Setup

First, run the migration to create the `ski_features` table:

1. Go to your Supabase dashboard
2. Navigate to **SQL Editor**
3. Run the migration file: `supabase/migrations/006_add_ski_features.sql`

## Feature Types

### Trails
- **Type:** `trail`
- **Difficulty options:** `green`, `blue`, `black`, `double-black`, `terrain-park`, `other`
- **Status options:** `open`, `closed`, `groomed`, `ungroomed`
- **Display:** Colored lines/polygons based on difficulty
  - Green = Green circle trails
  - Blue = Blue square trails  
  - Black = Black diamond trails
  - Double-black = Purple double diamond
  - Terrain park = Pink

### Lifts
- **Type:** `lift`
- **Display:** Red dashed lines
- **Use for:** Chairlifts, gondolas, T-bars, etc.

### Boundaries
- **Type:** `boundary`
- **Display:** Black dashed line with light fill
- **Use for:** Resort boundaries, ski area limits

### Areas
- **Type:** `area`
- **Display:** Blue filled polygons
- **Use for:** Specific ski areas, zones

## Adding Features via SQL

### Example: Adding a Green Trail

```sql
INSERT INTO ski_features (
  resort_id,
  name,
  type,
  difficulty,
  geometry,
  status,
  active,
  order_index
) VALUES (
  'your-resort-id-here', -- Replace with your resort ID
  'Easy Street',
  'trail',
  'green',
  '{
    "type": "LineString",
    "coordinates": [
      [-118.9412, 49.73283],
      [-118.9400, 49.73300],
      [-118.9390, 49.73320]
    ]
  }'::jsonb,
  'open',
  true,
  0
);
```

### Example: Adding a Lift

```sql
INSERT INTO ski_features (
  resort_id,
  name,
  type,
  geometry,
  status,
  active
) VALUES (
  'your-resort-id-here',
  'Chairlift 1',
  'lift',
  '{
    "type": "LineString",
    "coordinates": [
      [-118.9412, 49.73283],
      [-118.9400, 49.73500]
    ]
  }'::jsonb,
  'open',
  true
);
```

### Example: Adding a Resort Boundary

```sql
INSERT INTO ski_features (
  resort_id,
  name,
  type,
  geometry,
  active
) VALUES (
  'your-resort-id-here',
  'Resort Boundary',
  'boundary',
  '{
    "type": "Polygon",
    "coordinates": [[
      [-118.9500, 49.7300],
      [-118.9300, 49.7300],
      [-118.9300, 49.7400],
      [-118.9500, 49.7400],
      [-118.9500, 49.7300]
    ]]
  }'::jsonb,
  true
);
```

## GeoJSON Format Reference

### LineString (for trails and lifts)
```json
{
  "type": "LineString",
  "coordinates": [
    [longitude, latitude],
    [longitude, latitude],
    ...
  ]
}
```

### Polygon (for boundaries and areas)
```json
{
  "type": "Polygon",
  "coordinates": [[
    [longitude, latitude],
    [longitude, latitude],
    [longitude, latitude],
    [longitude, latitude],
    [longitude, latitude]  // First and last coordinate must be the same
  ]]
}
```

### MultiLineString (for complex trails)
```json
{
  "type": "MultiLineString",
  "coordinates": [
    [[longitude, latitude], [longitude, latitude], ...],
    [[longitude, latitude], [longitude, latitude], ...]
  ]
}
```

## Getting Coordinates

### Method 1: Using Online Tools
1. Go to https://geojson.io/ or https://geoman.io/
2. Draw your trails/lifts on the map
3. Copy the GeoJSON geometry
4. Use it in your INSERT statement

### Method 2: Using QGIS
1. Import your resort map/trail data
2. Export layers as GeoJSON
3. Extract the geometry from the GeoJSON Feature

### Method 3: From Existing Trail Maps
1. Use Google Earth or Google Maps
2. Draw paths and export as KML
3. Convert KML to GeoJSON using an online converter
4. Extract the coordinates

## Finding Your Resort ID

```sql
SELECT id, name, slug FROM resorts WHERE slug = 'your-resort-slug';
```

## Bulk Import from CSV

If you have trail data in CSV format, you can:

1. Convert to GeoJSON using a script
2. Use a bulk insert script or import tool
3. Or manually insert via Supabase dashboard

## Updating Features

```sql
UPDATE ski_features
SET 
  name = 'New Trail Name',
  status = 'closed',
  geometry = '{...}'::jsonb
WHERE id = 'feature-id-here';
```

## Viewing Your Features

After adding features, they will automatically appear on the map at:
`/[resort-slug]/game/map`

The map will:
- Show trails colored by difficulty
- Show lifts as red dashed lines
- Show boundaries as dashed outlines
- Include a layer switcher to toggle between Ski Map and OpenStreetMap

## Admin Panel Integration (Future)

In the future, we'll add an admin interface to:
- Upload GeoJSON files
- Draw features directly on the map
- Edit existing features
- Manage trail status (open/closed)

For now, use SQL or the Supabase dashboard to manage features.

## Tips

1. **Start simple:** Add one trail first to test the format
2. **Use LineString for trails:** Most trails are simple lines
3. **Order matters:** Use `order_index` to control display order
4. **Check coordinates:** Make sure longitude/latitude are correct (longitude first in GeoJSON!)
5. **Test visibility:** Set `active = true` to see features on the map

## Troubleshooting

**Features not showing?**
- Check `active = true`
- Verify `resort_id` matches your resort
- Ensure geometry is valid GeoJSON
- Check browser console for errors

**Wrong colors?**
- Verify `difficulty` is set correctly for trails
- Check `type` matches expected values

**Coordinates wrong?**
- Remember: GeoJSON uses `[longitude, latitude]` (not lat/lng)
- Verify coordinates are in the correct format

