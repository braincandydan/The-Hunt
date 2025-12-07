# QGIS Integration Guide for The Hunt App

This guide explains how to use QGIS (Quantum GIS) to create customized maps for your ski resort scavenger hunt app.

## Overview

Your app currently uses:
- **Leaflet.js** for map rendering
- **Standard tile layers** (CartoDB, OSM, OpenTopoMap) with CSS filters
- **GeoJSON data** stored in Supabase for ski features (trails, lifts, boundaries, roads)
- **Client-side styling** based on feature types and difficulty

QGIS can help you:
1. Create custom-styled base maps
2. Process and enhance GeoJSON data before import
3. Generate custom map tiles
4. Create static map images
5. Style vector data with professional cartography

---

## 1. Setting Up QGIS

### Installation
1. Download QGIS from [qgis.org](https://qgis.org)
2. Install the latest LTR (Long Term Release) version
3. Optional: Install plugins:
   - **QuickOSM** - Download OpenStreetMap data
   - **TileLayer Plugin** - Add various tile services
   - **qgis2web** - Export maps to web formats

### Initial Setup
1. Open QGIS
2. Set CRS (Coordinate Reference System) to **EPSG:4326** (WGS84) - matches your GeoJSON data
3. Enable on-the-fly CRS transformation: `Project → Properties → CRS`

---

## 2. Loading Your Data into QGIS

### Method A: Import GeoJSON from Database

1. **Export GeoJSON from Supabase:**
   ```sql
   -- Export all ski features for a resort
   SELECT jsonb_build_object(
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
   )
   FROM ski_features
   WHERE resort_id = 'your-resort-id' AND active = true;
   ```

2. **Load in QGIS:**
   - `Layer → Add Layer → Add Vector Layer`
   - Select your GeoJSON file
   - Or use `Database → DB Manager → PostGIS` to connect directly to Supabase

### Method B: Load from Existing Scripts

Your import scripts already create GeoJSON files. Load them directly:
- `scripts/import-ski-features.ts` outputs GeoJSON
- Load these files into QGIS for styling

### Method C: Download OpenStreetMap Data

1. Use **QuickOSM** plugin:
   - `Vector → QuickOSM → QuickOSM`
   - Search for your resort area
   - Download: `piste:type=downhill`, `aerialway`, `boundary`

---

## 3. Styling Features in QGIS

### A. Style Trails by Difficulty

1. Select your trails layer
2. Open `Layer Properties → Symbology`
3. Choose **Categorized** style
4. Column: `difficulty`
5. Set colors:
   - **green**: `#10b981` (Tailwind green-500)
   - **blue**: `#3b82f6` (Tailwind blue-500)
   - **black**: `#1f2937` (Tailwind gray-800)
   - **double-black**: `#7c3aed` (Tailwind violet-600)
   - **terrain-park**: `#ec4899` (Tailwind pink-500)

6. Set line width: 4-5px for trails
7. Add labels: `Layer Properties → Labels`
   - Enable labels
   - Field: `name`
   - Font size: 12px, bold
   - Text color: Match trail difficulty color

### B. Style Lifts

1. Select lifts layer
2. **Symbology → Simple Line**
3. Color: `#ff0000` (red)
4. Style: **Dash Line** (10px dash, 5px gap)
5. Width: 4px

### C. Style Boundaries

1. Select boundary layer
2. **Symbology → Simple Fill**
3. Fill color: `#f0f0f0` (light gray)
4. Stroke: `#000000` (black), 2px, dashed (15px dash, 10px gap)
5. Fill opacity: 10%

### D. Style Roads

1. Select roads layer
2. **Symbology → Simple Line**
3. Color: `#6b7280` (gray-500)
4. Width: 2px
5. Opacity: 60%

---

## 4. Creating Custom Base Maps

### Option A: Style OSM Data in QGIS

1. Download OSM data for your resort area
2. Style it with a "snowy" theme:
   - Buildings: Light gray/white
   - Roads: Muted colors
   - Water: Light blue
   - Vegetation: Desaturated greens
3. Export as tiles (see section 5)

### Option B: Create Hillshade/Terrain Base

1. Download DEM (Digital Elevation Model) data:
   - **SRTM** data from USGS
   - Or use QGIS **SRTM Downloader** plugin
2. Create hillshade:
   - `Raster → Analysis → Hillshade`
   - Set azimuth: 315° (northwest light)
   - Set altitude: 45°
3. Style with color ramp:
   - White for high elevations (snow)
   - Light gray for mid elevations
   - Darker for valleys
4. Export as tiles

### Option C: Use QGIS Print Composer for Static Maps

1. `Project → New Print Layout`
2. Add map to layout
3. Set scale and extent
4. Add legend, scale bar, north arrow
5. Export as high-resolution image (PNG/PDF)
6. Use as static background in your app

---

## 5. Exporting Custom Map Tiles

### Using qgis2web Plugin

1. **Install qgis2web:**
   - `Plugins → Manage and Install Plugins`
   - Search "qgis2web"
   - Install

2. **Export to Leaflet:**
   - `Web → qgis2web → Create web map`
   - Choose **Leaflet** as format
   - Set export folder
   - Configure:
     - Min zoom: 10
     - Max zoom: 18
     - Extent: Your resort boundary
   - Click "Export"

3. **Result:**
   - Generates HTML, JS, and tile images
   - Tiles in `tiles/` folder
   - Use these tiles in your Leaflet map

4. **Integrate into your app:**
   ```typescript
   // In MapView.tsx, add custom tile layer:
   const customTiles = L.tileLayer('/tiles/{z}/{x}/{y}.png', {
     attribution: 'Custom QGIS Map',
     maxZoom: 18,
     minZoom: 10,
     bounds: yourResortBounds
   })
   ```

### Using QTiles Plugin (Alternative)

1. Install **QTiles** plugin
2. `Plugins → QTiles`
3. Set:
   - Zoom levels: 10-18
   - Extent: Your resort area
   - Output folder
4. Export as MBTiles or individual tiles
5. Host tiles on your server or use a tile server

---

## 6. Processing Data Before Import

### A. Clean and Simplify GeoJSON

1. Load GeoJSON in QGIS
2. Simplify geometries (reduce file size):
   - `Vector → Geometry Tools → Simplify Geometries`
   - Tolerance: 0.0001 (adjust based on zoom levels)
3. Fix invalid geometries:
   - `Vector → Geometry Tools → Check Validity`
   - Fix any errors found
4. Export cleaned GeoJSON:
   - Right-click layer → `Export → Save Features As`
   - Format: GeoJSON
   - CRS: EPSG:4326

### B. Add Elevation Data

1. Load DEM raster (SRTM, ASTER, etc.)
2. Extract elevation to points:
   - `Processing → Toolbox → Sample Raster Values`
   - Or use `Raster → Analysis → Zonal Statistics`
3. Add elevation to trail properties
4. Export with elevation metadata

### C. Calculate Trail Statistics

1. Add fields to attribute table:
   - Length (using `$length` in Field Calculator)
   - Elevation gain/loss
   - Average slope
2. Export enriched GeoJSON
3. Import using your existing scripts

---

## 7. Creating Custom Symbology

### A. Custom Trail Markers

1. Create custom SVG icons for trail difficulty
2. Use in QGIS:
   - `Symbology → SVG Marker`
   - Point placement: `Central Point` or `Along Line`
3. Export styled layer

### B. Trail Labels with Arrows

1. Enable labels on trails
2. Use **Text Along Line** placement
3. Add directional arrows:
   - Create arrow SVG
   - Use as marker along line
   - Rotate based on line direction

### C. 3D Visualization

1. Load DEM and vector data
2. `View → 3D Map Views → New 3D Map View`
3. Set elevation exaggeration
4. Export as image or video for marketing

---

## 8. Workflow Integration

### Recommended Workflow

1. **Data Preparation:**
   ```
   QGIS → Load OSM/GeoJSON → Clean → Style → Export GeoJSON
   ```

2. **Import to Database:**
   ```bash
   npx tsx scripts/import-ski-features.ts <resort-id> <styled-geojson> trail
   ```

3. **Create Base Map:**
   ```
   QGIS → Style base data → Export tiles → Host on server
   ```

4. **Update MapView.tsx:**
   ```typescript
   // Add custom tile layer
   const customBase = L.tileLayer('https://your-server.com/tiles/{z}/{x}/{y}.png', {
     attribution: 'Custom QGIS Map',
     maxZoom: 18,
     bounds: resortBounds
   })
   ```

---

## 9. Advanced Techniques

### A. Create Themed Maps

- **Winter Theme:** Desaturated colors, white base, cool tones
- **Summer Theme:** Vibrant greens, warm tones
- **Night Mode:** Dark base, bright trails

### B. Add Contour Lines

1. Generate contours from DEM:
   - `Raster → Extraction → Contour`
   - Interval: 50m or 100m
2. Style with subtle gray lines
3. Export as separate layer

### C. Add Slope Shading

1. Calculate slope from DEM:
   - `Raster → Analysis → Slope`
2. Style with color ramp (green=easy, red=steep)
3. Use as overlay layer

### D. Create Map Stylesheets (QML)

1. Save layer style:
   - `Layer Properties → Style → Save Style`
   - Format: QML (QGIS Style File)
2. Reuse styles across projects
3. Share with team

---

## 10. Hosting Custom Tiles

### Option A: Static File Hosting

1. Export tiles from QGIS
2. Upload to:
   - Your Next.js `public/tiles/` folder
   - Or CDN (Cloudflare, AWS S3)
3. Serve via Leaflet:
   ```typescript
   L.tileLayer('/tiles/{z}/{x}/{y}.png', {...})
   ```

### Option B: Tile Server

Use tools like:
- **TileServer GL** - Fast tile server
- **Mapnik** - Cartographic toolkit
- **GeoServer** - Full-featured server

### Option C: MBTiles

1. Export as MBTiles from QGIS
2. Use **mbtiles-server** or **TileServer GL**
3. Serve via API endpoint

---

## 11. Performance Considerations

### Tile Optimization

- **Zoom levels:** Only export needed levels (10-18)
- **Tile size:** 256x256 or 512x512 pixels
- **Format:** PNG for transparency, JPEG for photos
- **Compression:** Optimize PNG files

### Vector Optimization

- Simplify geometries before export
- Remove unnecessary attributes
- Use appropriate precision (6-7 decimal places for lat/lng)

---

## 12. Example: Complete Workflow

### Step-by-Step: Create Custom Snowy Base Map

1. **Download OSM data:**
   - QuickOSM plugin → Download resort area

2. **Style in QGIS:**
   - Buildings: White fill, light gray outline
   - Roads: Light gray, thin lines
   - Water: Light blue (#87CEEB)
   - Background: White (#FFFFFF)

3. **Add hillshade:**
   - Download SRTM DEM
   - Generate hillshade
   - Overlay with 30% opacity

4. **Export tiles:**
   - qgis2web → Leaflet export
   - Zoom levels: 10-18
   - Extent: Resort boundary

5. **Host tiles:**
   - Upload to `public/tiles/` or CDN

6. **Update app:**
   ```typescript
   // In MapView.tsx
   const customSnowyBase = L.tileLayer('/tiles/{z}/{x}/{y}.png', {
     attribution: 'Custom QGIS Map',
     maxZoom: 18,
     bounds: expandedBounds
   })
   ```

---

## Resources

- **QGIS Documentation:** https://docs.qgis.org/
- **Leaflet Documentation:** https://leafletjs.com/
- **GeoJSON Spec:** https://geojson.org/
- **OpenStreetMap Wiki:** https://wiki.openstreetmap.org/
- **SRTM Data:** https://earthexplorer.usgs.gov/

---

## Tips

1. **Start small:** Test with a small area first
2. **Version control:** Save QGIS project files (.qgs) in git
3. **Consistent styling:** Create style templates for reuse
4. **Coordinate systems:** Always use EPSG:4326 for web maps
5. **Test on mobile:** Custom tiles should work on mobile devices
6. **Cache tiles:** Use service workers to cache tiles offline

---

## Next Steps

1. Install QGIS and load your existing GeoJSON data
2. Experiment with styling trails, lifts, and boundaries
3. Export a small test area as tiles
4. Integrate custom tiles into your MapView component
5. Iterate and refine the styling

For questions or issues, refer to the QGIS community forums or your development team.

