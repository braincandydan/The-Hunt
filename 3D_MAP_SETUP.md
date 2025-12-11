# 3D Map Integration Guide

This guide explains how to integrate your QGIS qgisthreejs 3D map export into the app.

## Overview

The app now supports both 2D (Leaflet) and 3D (Three.js) map views. You can toggle between them using the button in the top-right corner of the map.

## Exporting from QGIS with qgisthreejs

1. **Install the Qgis2threejs plugin** in QGIS:
   - Go to `Plugins → Manage and Install Plugins`
   - Search for "Qgis2threejs"
   - Install the plugin

2. **Prepare your QGIS project**:
   - Load your ski runs, lifts, DEM, and base map layers
   - Style them as desired
   - Ensure your project CRS is set to EPSG:4326 (WGS84) for compatibility

3. **Export the 3D scene**:
   - Go to `Web → Qgis2threejs → Export to Three.js`
   - Configure your 3D settings:
     - Set the terrain height (DEM elevation scale)
     - Choose export format (HTML is recommended for easiest integration)
     - Select template (mobile-friendly template is available)
   - Click "Export" and save to a folder

4. **Export structure**:
   ```
   your-export-folder/
   ├── index.html          # Main HTML file
   ├── js/                 # JavaScript files
   ├── textures/           # Texture files
   └── models/             # 3D model files (if any)
   ```

## Integration Steps

### Option 1: Iframe Mode (Easiest - for HTML exports)

1. **Copy your export folder** to the `public` directory:
   ```
   public/
   └── 3d-map/              # Your qgisthreejs export
       ├── index.html
       ├── js/
       └── ...
   ```

2. **Update MapPageWrapper** to pass the scene URL:
   ```tsx
   <MapView
     // ... other props
     scene3DUrl="/3d-map/index.html"
     scene3DCenter={[49.73283, -118.9412]} // [lat, lng] - center of your map
   />
   ```

3. **Test the integration**:
   - Navigate to the map page
   - Click the 3D toggle button (cube icon) in the top-right
   - The 3D scene should load in an iframe

### Option 2: Custom Three.js Integration (Advanced)

If you want more control or need to integrate markers/features directly into the 3D scene:

1. **Extract scene data** from your qgisthreejs export
2. **Load it in MapView3D** component
3. **Customize** the `Scene3D` component in `MapView3D.tsx` to match your scene structure

## Features Available in 3D Mode

- ✅ **Sign markers**: Displayed as 3D spheres with floating animation
- ✅ **Ski trails**: Rendered as 3D tubes following the terrain
- ✅ **Location tracking**: Same GPS tracking as 2D mode
- ✅ **Speed display**: Shows current, top, and average speed
- ✅ **Interactive controls**: Rotate, zoom, and pan the 3D scene

## Customization

### Adjusting Marker Appearance

Edit `components/game/MapView3D.tsx`:
- Modify the `Marker3D` component to change marker size, color, or animation
- Adjust the `sphereGeometry` args to change marker size
- Modify colors in the `meshStandardMaterial`

### Adjusting Trail Appearance

Edit the `Trail3D` component:
- Change `tubeGeometry` parameters (radius, segments)
- Modify colors based on difficulty
- Add elevation data from your DEM

### Camera Settings

In the `Canvas` component, adjust:
- `PerspectiveCamera` position and `fov` (field of view)
- `OrbitControls` min/max distance for zoom limits

## Troubleshooting

### 3D scene doesn't load
- Check that the path to `scene3DUrl` is correct
- Ensure all files from the export are in the `public` directory
- Check browser console for errors

### Markers not appearing
- Verify that sign coordinates are in the correct format (lat/lng)
- Check that the center coordinates match your map's center
- Adjust the coordinate conversion in `Scene3D` if needed

### Performance issues
- Reduce the number of trail segments
- Lower the terrain resolution
- Use simpler geometries for markers

## Coordinate System Notes

The 3D map uses a simplified coordinate conversion:
- GeoJSON coordinates [lng, lat] are converted to Three.js [x, y, z]
- 1 degree ≈ 111,320 meters (approximate)
- For accurate positioning, you may need to implement proper map projection (e.g., Web Mercator)

For production use, consider using a proper coordinate transformation library if high accuracy is required.

## Next Steps

1. Export your QGIS 3D map using qgisthreejs
2. Place the export files in `public/3d-map/`
3. Update `MapPageWrapper.tsx` to pass `scene3DUrl="/3d-map/index.html"`
4. Test the 3D view and adjust settings as needed


