# QGIS GeoJSON Exports

This folder is for GeoJSON files exported from QGIS that you want to display on the 3D map.

## How to Use

1. **Export GeoJSON from QGIS:**
   - In QGIS, right-click on the layer you want to export
   - Select "Export" > "Save Features As..."
   - Choose "GeoJSON" format
   - Save the file to this folder (`public/3d-map/geojson/`)

2. **Add the file path to MapPageWrapper:**
   - Open `components/game/MapPageWrapper.tsx`
   - Find the `additionalGeoJSONPaths` prop
   - Add your GeoJSON file path(s):
   ```tsx
   additionalGeoJSONPaths={[
     '/3d-map/geojson/tree-line.json',
     '/3d-map/geojson/runs.json',
   ]}
   ```

3. **Supported Features:**
   - **LineString** and **MultiLineString**: Rendered as 3D trails/lines
   - **Polygon** and **MultiPolygon**: Not yet supported (can be added if needed)
   - **Point**: Not yet supported (use signs from Supabase instead)

## Color Coding

The 3D map will automatically assign colors based on feature properties:
- **Tree/Forest layers**: Green (#16a34a)
- **Boundary layers**: Amber (#f59e0b)
- **Road/Path layers**: Gray (#9ca3af)
- **Other**: Gray (#6b7280) or uses `color` property if available

## Example Files

- `tree-line.json` - Tree line boundary
- `runs.json` - Additional ski runs
- `boundaries.json` - Resort boundaries

## Notes

- GeoJSON files should use WGS84 (EPSG:4326) coordinates
- The coordinate system will be automatically converted to match the terrain mesh
- Large files may impact performance - consider simplifying geometries in QGIS before export


