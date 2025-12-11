# Map Options Guide

The app uses **Leaflet** with **OpenStreetMap** by default - completely free with no API key or credit card required.

## Available Map Tile Options

### 1. OpenStreetMap (Default) ✅
**Free, no API key needed**

The default option uses standard OpenStreetMap tiles:
```
https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png
```

**Pros:**
- Completely free
- No registration required
- Works worldwide
- Good for general terrain and roads

**Cons:**
- Doesn't show ski-specific features (trails, lifts, etc.)

### 2. OpenSkiMap (Ski Resort Maps) 🎿
**Free, no API key needed**

Specialized maps for ski resorts showing trails, lifts, and resort features:
```
https://tiles.openskimap.org/{z}/{x}/{y}.png
```

To use this, uncomment the OpenSkiMap tile layer in `components/game/MapView.tsx`:
```typescript
// Uncomment these lines:
L.tileLayer('https://tiles.openskimap.org/{z}/{x}/{y}.png', {
  attribution: '© <a href="https://www.openskimap.org/">OpenSkiMap</a> contributors',
  maxZoom: 18,
}).addTo(map.current)
```

**Pros:**
- Shows ski trails, lifts, and resort infrastructure
- Free and open source
- Great for ski resort applications

**Cons:**
- Coverage may be limited to popular ski areas
- May not have data for all resorts

### 3. Your Own GIS Data 🗺️
**Load custom resort maps**

You can load your own custom map tiles or GIS data if you have:
- Custom trail maps
- Resort-specific base maps
- Proprietary mapping data

**How to use:**
1. Host your map tiles (or use a tile server)
2. Update the tile layer URL in `components/game/MapView.tsx`:
```typescript
L.tileLayer('https://your-tile-server.com/{z}/{x}/{y}.png', {
  attribution: 'Your Attribution',
  maxZoom: 18,
}).addTo(map.current)
```

**Tile Server Options:**
- **MapTiler Cloud** (has free tier with attribution)
- **Your own server** (serve tiles from your infrastructure)
- **GeoJSON overlays** (load custom vector data on top of base map)

### 4. Other Free Options

#### Stamen Maps
```typescript
// Terrain style
L.tileLayer('https://stamen-tiles-{s}.a.ssl.fastly.net/terrain/{z}/{x}/{y}.jpg', {
  attribution: 'Map tiles by <a href="http://stamen.com">Stamen Design</a>',
  subdomains: 'abcd',
  maxZoom: 18
}).addTo(map.current)
```

#### CartoDB Positron (Clean, minimal)
```typescript
L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png', {
  attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors © <a href="https://carto.com/attributions">CARTO</a>',
  subdomains: 'abcd',
  maxZoom: 19
}).addTo(map.current)
```

## Switching Map Providers

To switch map providers:

1. Open `components/game/MapView.tsx`
2. Find the `L.tileLayer()` call (around line 43)
3. Replace the URL and attribution
4. Save and refresh

## Adding Custom Overlays

You can also add custom overlays (GeoJSON, KML, etc.) on top of any base map:

```typescript
// Add a GeoJSON overlay
fetch('/path/to/your/resort-data.geojson')
  .then(response => response.json())
  .then(data => {
    L.geoJSON(data, {
      style: {
        color: '#ff7800',
        weight: 2,
        opacity: 0.8
      }
    }).addTo(map.current)
  })
```

## Recommended Setup for Ski Resorts

1. **Start with OpenSkiMap** - It shows ski-specific features
2. **Fallback to OpenStreetMap** - If OpenSkiMap doesn't have coverage for your resort
3. **Add custom overlays** - If you need to show custom trails or features

## Questions?

- OpenSkiMap coverage: https://www.openskimap.org/
- Leaflet documentation: https://leafletjs.com/
- OpenStreetMap: https://www.openstreetmap.org/

