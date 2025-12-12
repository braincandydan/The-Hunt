# QGIS Integration Example: Adding Custom Tiles to Your App

This is a practical example of how to integrate QGIS-generated custom tiles into your MapView component.

## Step 1: Export Tiles from QGIS

1. In QGIS, style your map as desired
2. Use **qgis2web** plugin:
   - `Web → qgis2web → Create web map`
   - Choose **Leaflet**
   - Set export folder: `public/tiles/`
   - Export

3. Result: Tiles in `public/tiles/{z}/{x}/{y}.png`

## Step 2: Update MapView.tsx

Add a custom QGIS tile layer option to your existing base layers:

```typescript
// In MapView.tsx, around line 123-147, add:

// Custom QGIS-generated tiles (if available)
const customQGISBase = L.tileLayer('/tiles/{z}/{x}/{y}.png', {
  attribution: 'Custom QGIS Map',
  maxZoom: 18,
  minZoom: 10,
  bounds: defaultBounds,
})

// Update tileLayersRef to include custom layer
tileLayersRef.current = [customQGISBase, snowyBase, osm, terrain]

// Update baseMaps object
const baseMaps = {
  'Custom QGIS Map': customQGISBase,  // Add this
  'Snowy Map': snowyBase,
  'Standard Map': osm,
  'Terrain Map': terrain,
}

// Update activeBaseLayer type
const [activeBaseLayer, setActiveBaseLayer] = useState<'qgis' | 'snowy' | 'standard' | 'terrain'>('qgis')
```

## Step 3: Update Layer Switching Logic

In the `switchBaseLayer` function (around line 672), add:

```typescript
const switchBaseLayer = (layerType: 'qgis' | 'snowy' | 'standard' | 'terrain') => {
  // ... existing code ...
  
  if (layerType === 'qgis') {
    newLayer = tileLayersRef.current[0] // Custom QGIS
  } else if (layerType === 'snowy') {
    newLayer = tileLayersRef.current[1] // CartoDB
  } else if (layerType === 'standard') {
    newLayer = tileLayersRef.current[2] // OSM
  } else {
    newLayer = tileLayersRef.current[3] // Terrain
  }
  
  // ... rest of function ...
}
```

## Step 4: Update UI Menu

In the layer menu dropdown (around line 1376), add the QGIS option:

```typescript
<button
  onClick={() => switchBaseLayer('qgis')}
  className={`w-full text-left px-4 py-3 hover:bg-gray-50 transition-colors flex items-center justify-between ${
    activeBaseLayer === 'qgis' ? 'bg-blue-50 text-blue-600' : 'text-gray-700'
  }`}
>
  <span className="font-medium">Custom QGIS Map</span>
  {activeBaseLayer === 'qgis' && (
    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
    </svg>
  )}
</button>
```

## Step 5: Handle Missing Tiles Gracefully

Add error handling for missing tiles:

```typescript
const customQGISBase = L.tileLayer('/tiles/{z}/{x}/{y}.png', {
  attribution: 'Custom QGIS Map',
  maxZoom: 18,
  minZoom: 10,
  bounds: defaultBounds,
  // Fallback to transparent tile if custom tile doesn't exist
  errorTileUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  // Or fallback to a base layer
  // tileSize: 256,
  // zoomOffset: 0,
})
```

## Alternative: Conditional Loading

Only load custom tiles if they exist:

```typescript
// Check if custom tiles exist (you'd need to implement this check)
const hasCustomTiles = await checkTilesExist('/tiles/10/0/0.png') // Check a sample tile

if (hasCustomTiles) {
  const customQGISBase = L.tileLayer('/tiles/{z}/{x}/{y}.png', {
    // ... options ...
  })
  tileLayersRef.current = [customQGISBase, snowyBase, osm, terrain]
} else {
  tileLayersRef.current = [snowyBase, osm, terrain]
}
```

## Testing

1. Export a small test area from QGIS (zoom level 10-12)
2. Place tiles in `public/tiles/`
3. Test in your app
4. Verify tiles load correctly
5. Check mobile responsiveness

## Performance Tips

- **Lazy load tiles:** Only load custom tiles when selected
- **Cache tiles:** Use service worker to cache tiles offline
- **Compress tiles:** Optimize PNG files before deployment
- **CDN hosting:** Host tiles on CDN for better performance

## Next Steps

1. Create a styled map in QGIS
2. Export tiles for your resort area
3. Integrate into MapView component
4. Test and iterate on styling



