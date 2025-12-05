'use client'

import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import 'leaflet-textpath'
import { Sign } from '@/lib/utils/types'

interface MapViewProps {
  resortSlug: string
  signs: Sign[]
  discoveredSignIds: Set<string>
  skiFeatures?: Array<{
    id: string
    name: string
    type: 'trail' | 'lift' | 'boundary' | 'area'
    difficulty?: string
    geometry: any // GeoJSON geometry
    status?: string
  }>
  resortName?: string
}

// Fix Leaflet default marker icon issue with Next.js
delete (L.Icon.Default.prototype as any)._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
})

export default function MapView({ resortSlug, signs, discoveredSignIds, skiFeatures = [], resortName = 'Resort' }: MapViewProps) {
  const mapContainer = useRef<HTMLDivElement>(null)
  const map = useRef<L.Map | null>(null)
  const markersRef = useRef<L.Marker[]>([])
  const layersRef = useRef<L.Layer[]>([])
  const labelsRef = useRef<L.Marker[]>([]) // Store fallback label markers
  const arrowsRef = useRef<L.Marker[]>([]) // Store arrow markers
  const textpathLayersRef = useRef<Array<{ layer: L.Polyline; text: string; options: any; color: string }>>([]) // Store layers with textpath labels
  const maskOverlayRef = useRef<L.Polygon | null>(null) // Store the grey mask overlay
  const tileLayersRef = useRef<L.TileLayer[]>([]) // Store tile layers so we can update their bounds
  const [currentZoom, setCurrentZoom] = useState(13) // Track zoom level
  const [sidebarOpen, setSidebarOpen] = useState(true) // Sidebar open/closed state
  const MIN_ZOOM_FOR_LABELS = 15 // Only show labels when zoomed in enough

  useEffect(() => {
    if (!mapContainer.current || map.current) return

    // Calculate center from signs or use default
    let center: [number, number] = [49.73283, -118.9412] // Ski resort location [lat, lng]
    let zoom = 16

    if (signs.length > 0) {
      const avgLat = signs.reduce((sum, s) => sum + parseFloat(s.lat.toString()), 0) / signs.length
      const avgLng = signs.reduce((sum, s) => sum + parseFloat(s.lng.toString()), 0) / signs.length
      center = [avgLat, avgLng]
      zoom = 13
    }

    // Initialize map with maxBounds set early to prevent loading tiles outside area
    // We'll refine this later when we have the boundary, but set a reasonable default
    const defaultBounds = L.latLngBounds(
      [center[0] - 0.5, center[1] - 0.5],
      [center[0] + 0.5, center[1] + 0.5]
    )
    
    map.current = L.map(mapContainer.current, {
      center,
      zoom,
      maxBounds: defaultBounds, // Prevent loading tiles outside initially
      maxBoundsViscosity: 1.0, // Strictly enforce bounds (1.0 = no panning outside)
    })

    // Try OpenSkiMap first (shows ski trails), fallback to OpenStreetMap
    const openskimap = L.tileLayer('https://tiles.openskimap.org/{z}/{x}/{y}.png', {
      attribution: '© <a href="https://www.openskimap.org/">OpenSkiMap</a> contributors',
      maxZoom: 18,
      errorTileUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      bounds: defaultBounds, // Initially restrict to default bounds, will be updated when boundary loads
    })

    const osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19,
      bounds: defaultBounds, // Initially restrict to default bounds, will be updated when boundary loads
    })

    // Store tile layers for later bounds updates
    tileLayersRef.current = [openskimap, osm]

    // Add base layer (try OpenSkiMap, fallback to OSM on error)
    openskimap.addTo(map.current)
    
    // If OpenSkiMap fails, switch to OSM
    openskimap.on('tileerror', () => {
      if (map.current && map.current.hasLayer(openskimap)) {
        map.current.removeLayer(openskimap)
        osm.addTo(map.current)
      }
    })

    // Layer control for switching base maps
    const baseMaps = {
      'Ski Map': openskimap,
      'OpenStreetMap': osm,
    }
    
    L.control.layers(baseMaps).addTo(map.current)

    // Track zoom level changes
    map.current.on('zoomend', () => {
      if (map.current) {
        const newZoom = map.current.getZoom()
        setCurrentZoom(newZoom)
        // Update label visibility based on zoom
        updateLabelVisibility(newZoom)
      }
    })
    
    // Set initial zoom
    const initialZoom = map.current.getZoom()
    setCurrentZoom(initialZoom)

    addMarkers()
    addSkiFeatures()
    
    // Restrict map view to ski area boundary (if available) - run after features are loaded
    setTimeout(() => {
      if (map.current && skiFeatures.length > 0) {
        const boundaryFeature = skiFeatures.find(f => f.type === 'boundary')
        if (boundaryFeature) {
          try {
            // Calculate bounds from boundary geometry
            const boundaryGeoJson = L.geoJSON(boundaryFeature.geometry)
            const boundaryBounds = boundaryGeoJson.getBounds()
            
            // Expand bounds by 20% on all sides to show area outside boundary
            const sw = boundaryBounds.getSouthWest()
            const ne = boundaryBounds.getNorthEast()
            const latDiff = ne.lat - sw.lat
            const lngDiff = ne.lng - sw.lng
            
            const expandedSW = L.latLng(
              sw.lat - (latDiff * 0.2),
              sw.lng - (lngDiff * 0.2)
            )
            const expandedNE = L.latLng(
              ne.lat + (latDiff * 0.2),
              ne.lng + (lngDiff * 0.2)
            )
            
            const expandedBounds = L.latLngBounds(expandedSW, expandedNE)
            
            // Set max bounds to restrict panning
            map.current.setMaxBounds(expandedBounds)
            
            // Update tile layer bounds to prevent loading tiles outside the boundary area
            // This is the key to actually preventing tile loading, not just panning
            // We need to recreate the tile layers with the new bounds option
            const openskimapUrl = 'https://tiles.openskimap.org/{z}/{x}/{y}.png'
            const osmUrl = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'
            
            // Get which layer is currently active
            const currentLayer = map.current && map.current.hasLayer(tileLayersRef.current[0]) 
              ? tileLayersRef.current[0] 
              : tileLayersRef.current[1]
            
            const isOpenSkiMap = currentLayer && (currentLayer as any)._url?.includes('openskimap')
            
            // Remove all tile layers from map
            tileLayersRef.current.forEach((layer) => {
              if (map.current && map.current.hasLayer(layer)) {
                map.current.removeLayer(layer)
              }
            })
            
            // Recreate OpenSkiMap layer with bounds
            const newOpenSkiMap = L.tileLayer(openskimapUrl, {
              attribution: '© <a href="https://www.openskimap.org/">OpenSkiMap</a> contributors',
              maxZoom: 18,
              errorTileUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
              bounds: expandedBounds, // Restrict tiles to boundary area
            })
            
            // Recreate OSM layer with bounds
            const newOSM = L.tileLayer(osmUrl, {
              attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
              maxZoom: 19,
              bounds: expandedBounds, // Restrict tiles to boundary area
            })
            
            // Update refs
            tileLayersRef.current = [newOpenSkiMap, newOSM]
            
            // Add error handler for OpenSkiMap
            newOpenSkiMap.on('tileerror', () => {
              if (map.current && map.current.hasLayer(newOpenSkiMap)) {
                map.current.removeLayer(newOpenSkiMap)
                newOSM.addTo(map.current)
              }
            })
            
            // Add the appropriate layer based on what was active before
            if (isOpenSkiMap) {
              newOpenSkiMap.addTo(map.current)
            } else {
              newOSM.addTo(map.current)
            }
            
            // Note: Layer control will continue to work with the new layers
            // The layers themselves are replaced but the control references will update automatically
            
            // Optionally set min zoom to prevent zooming out too far
            // This ensures the boundary area is always visible
            const minZoom = map.current.getBoundsZoom(expandedBounds, true)
            if (minZoom < map.current.getMinZoom()) {
              map.current.setMinZoom(Math.max(minZoom - 1, 10)) // Allow slight zoom out but not too much
            }
            
            // Create a grey mask overlay for areas outside the boundary
            // We'll create a polygon covering the expanded bounds with the boundary as a hole
            try {
              // Remove existing mask if any
              if (maskOverlayRef.current && map.current.hasLayer(maskOverlayRef.current)) {
                map.current.removeLayer(maskOverlayRef.current)
              }
              
              // Get boundary coordinates (convert from GeoJSON format [lng, lat] to Leaflet [lat, lng])
              let boundaryCoords: [number, number][] = []
              if (boundaryFeature.geometry.type === 'Polygon') {
                // Reverse coordinates: GeoJSON is [lng, lat], Leaflet needs [lat, lng]
                boundaryCoords = boundaryFeature.geometry.coordinates[0].map((coord: number[]): [number, number] => [coord[1], coord[0]])
              } else if (boundaryFeature.geometry.type === 'MultiPolygon') {
                // Take the first polygon's outer ring
                boundaryCoords = boundaryFeature.geometry.coordinates[0][0].map((coord: number[]): [number, number] => [coord[1], coord[0]])
              }
              
              if (boundaryCoords.length > 0) {
                // Create outer rectangle covering expanded bounds
                const outerRect: [number, number][] = [
                  [expandedSW.lat, expandedSW.lng],
                  [expandedNE.lat, expandedSW.lng],
                  [expandedNE.lat, expandedNE.lng],
                  [expandedSW.lat, expandedNE.lng],
                  [expandedSW.lat, expandedSW.lng], // Close the polygon
                ]
                
                // Create polygon with hole: outer ring is the rectangle, inner ring is the boundary
                // Leaflet uses nested arrays: [[outer ring], [inner ring (hole)]]
                const maskPolygon = L.polygon([outerRect, boundaryCoords] as [number, number][][], {
                  fillColor: '#333333',
                  fillOpacity: 0.6,
                  color: '#333333',
                  weight: 0,
                  interactive: false, // Don't block map interactions
                })
                
                maskPolygon.addTo(map.current)
                maskOverlayRef.current = maskPolygon
              }
            } catch (maskError) {
              console.warn('Could not create mask overlay:', maskError)
            }
            
            // Fit the map to the expanded bounds initially (only if not already fitted by markers)
            if (signs.length === 0) {
              map.current.fitBounds(expandedBounds, {
                padding: [20, 20],
                maxZoom: 17,
              })
            }
          } catch (e) {
            console.warn('Could not restrict map to boundary:', e)
          }
        }
      }
      
      // Update label visibility after features are loaded
      if (map.current) {
        updateLabelVisibility(map.current.getZoom())
      }
    }, 150)

    return () => {
      // Cleanup
      markersRef.current.forEach((marker) => marker.remove())
      markersRef.current = []
      layersRef.current.forEach((layer) => map.current?.removeLayer(layer))
      layersRef.current = []
          // Remove textpath labels
          textpathLayersRef.current.forEach(({ layer }) => {
            try {
              if ((layer as any).removeText) {
                (layer as any).removeText()
              }
            } catch (e) {
              // Ignore errors
            }
          })
          textpathLayersRef.current = []
          
          labelsRef.current.forEach((label) => map.current?.removeLayer(label))
          labelsRef.current = []
          arrowsRef.current.forEach((arrow) => map.current?.removeLayer(arrow))
          arrowsRef.current = []
          if (maskOverlayRef.current && map.current?.hasLayer(maskOverlayRef.current)) {
            map.current.removeLayer(maskOverlayRef.current)
          }
          maskOverlayRef.current = null
      if (map.current) {
        map.current.remove()
        map.current = null
      }
    }
  }, [])

  useEffect(() => {
    if (map.current) {
      // Update markers when discoveredSignIds changes
      markersRef.current.forEach((marker) => marker.remove())
      markersRef.current = []
      addMarkers()
    }
  }, [discoveredSignIds])

  // Helper function to get midpoint of a line
  const getMidpoint = (coords: number[][]): [number, number] => {
    if (coords.length === 0) return [0, 0]
    const midIndex = Math.floor(coords.length / 2)
    return [coords[midIndex][1], coords[midIndex][0]] // [lat, lng]
  }

  // Helper function to calculate bearing (direction) between two points
  const getBearing = (point1: [number, number], point2: [number, number]): number => {
    const lat1 = point1[0] * Math.PI / 180
    const lat2 = point2[0] * Math.PI / 180
    const dLon = (point2[1] - point1[1]) * Math.PI / 180
    const y = Math.sin(dLon) * Math.cos(lat2)
    const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon)
    const bearing = Math.atan2(y, x) * 180 / Math.PI
    return (bearing + 360) % 360
  }

  // Update label visibility based on zoom level
  const updateLabelVisibility = (zoom: number) => {
    if (!map.current) return
    
    const shouldShow = zoom >= MIN_ZOOM_FOR_LABELS
    
    // Update textpath labels
    textpathLayersRef.current.forEach(({ layer, text, options }) => {
      try {
        if ((layer as any).setText && (layer as any).removeText) {
          if (shouldShow) {
            // Add text if not already shown
            (layer as any).setText(text, options)
          } else {
            // Remove text if shown
            (layer as any).removeText()
          }
        }
      } catch (e) {
        console.warn('Error updating textpath label:', e)
      }
    })
    
    // Update fallback label markers
    labelsRef.current.forEach((label) => {
      if (shouldShow && !map.current!.hasLayer(label)) {
        label.addTo(map.current!)
      } else if (!shouldShow && map.current!.hasLayer(label)) {
        map.current!.removeLayer(label)
      }
    })
    
    // Update arrow markers
    arrowsRef.current.forEach((arrow) => {
      if (shouldShow && !map.current!.hasLayer(arrow)) {
        arrow.addTo(map.current!)
      } else if (!shouldShow && map.current!.hasLayer(arrow)) {
        map.current!.removeLayer(arrow)
      }
    })
  }

  // Helper function to get coordinates from geometry
  const getCoordinates = (geometry: any): number[][] => {
    if (geometry.type === 'LineString') {
      return geometry.coordinates
    } else if (geometry.type === 'MultiLineString') {
      return geometry.coordinates.flat()
    } else if (geometry.type === 'Polygon') {
      return geometry.coordinates[0]
    } else if (geometry.type === 'MultiPolygon') {
      return geometry.coordinates.flat().flat()
    }
    return []
  }

  // Add label and directional arrows for trails
  const addTrailLabels = (feature: any, layer: L.Layer) => {
    if (!map.current) return
    if (feature.type !== 'trail' && feature.type !== 'lift') return
    if (!feature.name) return

    const coords = getCoordinates(feature.geometry)
    if (coords.length < 2) return

    const labelColor = feature.properties?.difficulty === 'green' ? '#10b981' :
                       feature.properties?.difficulty === 'blue' ? '#3b82f6' :
                       feature.properties?.difficulty === 'black' ? '#1f2937' :
                       feature.properties?.difficulty === 'double-black' ? '#7c3aed' :
                       feature.type === 'lift' ? '#ef4444' : '#6b7280'

    // Add text labels along the path
    // Only add if layer is a Polyline
    if (layer instanceof L.Polyline) {
      const textpathOptions = {
        repeat: false,
        offset: 5,
        attributes: {
          fill: labelColor,
          'font-weight': '600',
          'font-size': '12px',
          'font-family': 'Arial, sans-serif',
          'stroke': '#ffffff',
          'stroke-width': '3px',
          'stroke-linejoin': 'round',
          'stroke-linecap': 'round',
          'paint-order': 'stroke',
        },
      }
      
      try {
        // Use leaflet-textpath to add text along the path (if available)
        if ((layer as any).setText && typeof (layer as any).setText === 'function') {
          // Store the layer, text, and options for zoom-based visibility control
          textpathLayersRef.current.push({
            layer,
            text: feature.name,
            options: textpathOptions,
            color: labelColor,
          })
          
          // Only add text if zoomed in enough
          if (currentZoom >= MIN_ZOOM_FOR_LABELS) {
            (layer as any).setText(feature.name, textpathOptions)
          }
          return // Successfully set up textpath, skip fallback
        }
      } catch (e) {
        console.log('TextPath not available, using fallback labels')
      }
      
      // Fallback: create multiple labels along the path
      const segmentCount = Math.min(3, Math.floor(coords.length / 10))
      if (segmentCount > 0) {
        const segmentLength = Math.floor(coords.length / (segmentCount + 1))
        for (let i = 1; i <= segmentCount; i++) {
          const pos = i * segmentLength
          if (pos < coords.length) {
            const labelPoint: [number, number] = [coords[pos][1], coords[pos][0]]
            
            // Calculate angle for text rotation
            let bearing = 0
            if (pos < coords.length - 1) {
              const point1: [number, number] = [coords[pos][1], coords[pos][0]]
              const point2: [number, number] = [coords[pos + 1][1], coords[pos + 1][0]]
              bearing = getBearing(point1, point2)
            }
            
            const labelIcon = L.divIcon({
              className: 'trail-label',
              html: `
                <div style="
                  transform: rotate(${bearing}deg);
                  font-weight: 600;
                  font-size: 12px;
                  color: ${labelColor};
                  text-shadow: 1px 1px 2px rgba(255,255,255,0.9), -1px -1px 2px rgba(255,255,255,0.9);
                  white-space: nowrap;
                  pointer-events: none;
                ">${feature.name}</div>
              `,
              iconSize: [120, 20],
              iconAnchor: [60, 10],
            })

            const labelMarker = L.marker(labelPoint, { 
              icon: labelIcon,
              interactive: false,
              keyboard: false,
            })
            
            // Only add to map if zoomed in enough
            if (currentZoom >= MIN_ZOOM_FOR_LABELS && map.current) {
              labelMarker.addTo(map.current)
            }
            
            labelsRef.current.push(labelMarker)
          }
        }
      }
    }

    // Add directional arrows along the trail (every ~25% of the way)
    if (coords.length > 3) {
      const arrowPositions = [
        Math.floor(coords.length * 0.25),
        Math.floor(coords.length * 0.5),
        Math.floor(coords.length * 0.75),
      ]

      arrowPositions.forEach((pos) => {
        if (pos >= coords.length - 1) return
        
        const point1: [number, number] = [coords[pos][1], coords[pos][0]]
        const point2: [number, number] = [coords[pos + 1][1], coords[pos + 1][0]]
        const bearing = getBearing(point1, point2)

        // Arrow should point in the direction of travel
        // The > symbol points right (90°) by default, so we rotate it to match the bearing
        // Bearing 0° = North, so we need to adjust: bearing - 90° to align with direction
        const arrowRotation = bearing - 90
        const arrowIcon = L.divIcon({
          className: 'trail-arrow',
          html: `
            <div style="
              transform: rotate(${arrowRotation}deg);
              color: ${labelColor};
              font-size: 14px;
              font-weight: bold;
              text-shadow: 1px 1px 2px rgba(255,255,255,0.9), -1px -1px 2px rgba(255,255,255,0.9);
              pointer-events: none;
              line-height: 1;
              display: inline-block;
            ">&gt;</div>
          `,
          iconSize: [14, 14],
          iconAnchor: [7, 7],
        })

        const arrowMarker = L.marker(point1, {
          icon: arrowIcon,
          interactive: false,
          keyboard: false,
        })
        
        // Only add to map if zoomed in enough
        if (currentZoom >= MIN_ZOOM_FOR_LABELS && map.current) {
          arrowMarker.addTo(map.current)
        }
        
        arrowsRef.current.push(arrowMarker)
      })
    }
  }

  useEffect(() => {
    if (map.current && skiFeatures.length > 0) {
      // Update ski features when they change
      layersRef.current.forEach((layer) => map.current?.removeLayer(layer))
      layersRef.current = []
      // Clear old labels and arrows
      if (map.current) {
        // Remove textpath labels
        textpathLayersRef.current.forEach(({ layer }) => {
          try {
            if ((layer as any).removeText) {
              (layer as any).removeText()
            }
          } catch (e) {
            // Ignore errors
          }
        })
        textpathLayersRef.current = []
        
        labelsRef.current.forEach((label) => map.current!.removeLayer(label))
        labelsRef.current = []
        arrowsRef.current.forEach((arrow) => map.current!.removeLayer(arrow))
        arrowsRef.current = []
      }
      addSkiFeatures()
      // Update label visibility based on current zoom
      if (map.current) {
        updateLabelVisibility(map.current.getZoom())
      }
    }
  }, [skiFeatures, currentZoom])

  const addMarkers = () => {
    if (!map.current) return

    signs.forEach((sign) => {
      const isFound = discoveredSignIds.has(sign.id)
      const lat = parseFloat(sign.lat.toString())
      const lng = parseFloat(sign.lng.toString())

      // Create custom colored marker icon
      const iconColor = isFound ? '#10b981' : '#6b7280' // green : gray
      const customIcon = L.divIcon({
        className: 'custom-leaflet-marker',
        html: `
          <div style="
            width: 32px;
            height: 32px;
            border-radius: 50%;
            background-color: ${iconColor};
            border: 3px solid white;
            box-shadow: 0 2px 4px rgba(0,0,0,0.3);
            cursor: pointer;
          "></div>
        `,
        iconSize: [32, 32],
        iconAnchor: [16, 16],
      })

      // Create popup content
      const popupContent = `
        <div style="padding: 8px; min-width: 200px;">
          <h3 style="font-weight: 600; margin-bottom: 4px; font-size: 16px;">${sign.name}</h3>
          ${sign.description ? `<p style="color: #6b7280; font-size: 14px; margin-bottom: 8px;">${sign.description}</p>` : ''}
          <a href="/${resortSlug}/game/sign/${sign.id}" style="color: #6366f1; font-size: 14px; text-decoration: underline;">View details</a>
        </div>
      `

      // Create marker
      const marker = L.marker([lat, lng], { icon: customIcon })
        .addTo(map.current!)
        .bindPopup(popupContent)

      markersRef.current.push(marker)
    })

    // Fit map to show all markers and features
    if (signs.length > 0 || skiFeatures.length > 0) {
      const bounds = L.latLngBounds(
        signs.map((sign) => [parseFloat(sign.lat.toString()), parseFloat(sign.lng.toString())])
      )
      
      // Extend bounds to include ski features
      skiFeatures.forEach((feature) => {
        try {
          const geoJson = L.geoJSON(feature.geometry)
          geoJson.eachLayer((layer: any) => {
            if (layer.getBounds) {
              bounds.extend(layer.getBounds())
            }
          })
        } catch (e) {
          console.error('Error adding feature to bounds:', e)
        }
      })
      
      map.current.fitBounds(bounds, {
        padding: [50, 50],
        maxZoom: 15,
      })
    }
  }

  const addSkiFeatures = () => {
    if (!map.current || skiFeatures.length === 0) return

    skiFeatures.forEach((feature) => {
      try {
        // Create GeoJSON feature from geometry
        const geoJsonFeature: GeoJSON.Feature = {
          type: 'Feature' as const,
          geometry: feature.geometry,
          properties: {
            name: feature.name,
            type: feature.type,
            difficulty: feature.difficulty,
            status: feature.status,
          },
        }

        // Define styles based on feature type and difficulty
        const getStyle = (props: any) => {
          const baseStyle: any = {
            weight: 3,
            opacity: 0.8,
            fillOpacity: 0.3,
          }

          switch (props.type) {
            case 'trail':
              // Color trails by difficulty - use more visible colors
              const difficulty = props.difficulty?.toLowerCase() || 'other'
              switch (difficulty) {
                case 'green':
                  baseStyle.color = '#10b981' // Tailwind green-500
                  baseStyle.fillColor = '#34d399' // Tailwind green-400
                  baseStyle.weight = 4
                  break
                case 'blue':
                  baseStyle.color = '#3b82f6' // Tailwind blue-500
                  baseStyle.fillColor = '#60a5fa' // Tailwind blue-400
                  baseStyle.weight = 4
                  break
                case 'black':
                  baseStyle.color = '#1f2937' // Tailwind gray-800
                  baseStyle.fillColor = '#4b5563' // Tailwind gray-600
                  baseStyle.weight = 5
                  break
                case 'double-black':
                  baseStyle.color = '#7c3aed' // Tailwind violet-600
                  baseStyle.fillColor = '#a78bfa' // Tailwind violet-400
                  baseStyle.weight = 5
                  break
                case 'terrain-park':
                  baseStyle.color = '#ec4899' // Tailwind pink-500
                  baseStyle.fillColor = '#f472b6' // Tailwind pink-400
                  baseStyle.weight = 4
                  break
                default:
                  baseStyle.color = '#6b7280' // Tailwind gray-500
                  baseStyle.fillColor = '#9ca3af' // Tailwind gray-400
                  baseStyle.weight = 3
              }
              // Ensure trails are visible even if closed
              if (props.status === 'closed') {
                baseStyle.opacity = 0.5
                baseStyle.fillOpacity = 0.15
                baseStyle.dashArray = '5, 5'
              }
              break

            case 'lift':
              baseStyle.color = '#ff0000'
              baseStyle.fillColor = '#ff6b6b'
              baseStyle.weight = 4
              baseStyle.dashArray = '10, 5' // Dashed line for lifts
              break

            case 'boundary':
              baseStyle.color = '#000000'
              baseStyle.fillColor = '#f0f0f0'
              baseStyle.weight = 2
              baseStyle.dashArray = '15, 10'
              baseStyle.fillOpacity = 0.1
              break

            case 'area':
              baseStyle.color = '#4169e1'
              baseStyle.fillColor = '#87ceeb'
              baseStyle.weight = 2
              baseStyle.fillOpacity = 0.2
              break

            default:
              baseStyle.color = '#808080'
              baseStyle.fillColor = '#d3d3d3'
          }

          // Dim closed trails
          if (props.status === 'closed') {
            baseStyle.opacity = 0.3
            baseStyle.fillOpacity = 0.1
          }

          return baseStyle
        }

        // Create GeoJSON layer with explicit style
        const props = geoJsonFeature.properties || {}
        const style = getStyle(props)
        
        // Debug logging for trails (only first few to avoid spam)
        if (props.type === 'trail' && Math.random() < 0.1) {
          console.log('Trail feature sample:', {
            name: props.name,
            type: props.type,
            difficulty: props.difficulty,
            color: style.color,
          })
        }
        
        const geoJsonLayer = L.geoJSON(geoJsonFeature, {
          style: () => style, // Use explicit style instead of function
          onEachFeature: (feature: any, layer: L.Layer) => {
            // Add popup with feature info
            const props = feature.properties
            const popupContent = `
              <div style="padding: 8px; min-width: 150px;">
                <h3 style="font-weight: 600; margin-bottom: 4px; font-size: 16px;">${props.name}</h3>
                <p style="color: #6b7280; font-size: 14px; margin-bottom: 4px;">
                  <strong>Type:</strong> ${props.type.charAt(0).toUpperCase() + props.type.slice(1)}
                </p>
                ${props.difficulty ? `<p style="color: #6b7280; font-size: 14px; margin-bottom: 4px;"><strong>Difficulty:</strong> ${props.difficulty}</p>` : ''}
                ${props.status ? `<p style="color: #6b7280; font-size: 14px;"><strong>Status:</strong> ${props.status}</p>` : ''}
              </div>
            `
            layer.bindPopup(popupContent)
            
            // Add labels and arrows for trails and lifts
            // Create a combined feature object with geometry and properties
            const combinedFeature = {
              ...feature,
              geometry: geoJsonFeature.geometry,
              properties: props,
              type: props.type,
              name: props.name,
            }
            
            // Add labels and arrows after layer is added
            setTimeout(() => {
              addTrailLabels(combinedFeature, layer)
            }, 0)
          },
        })

        geoJsonLayer.addTo(map.current!)
        layersRef.current.push(geoJsonLayer)
      } catch (e) {
        console.error('Error adding ski feature:', feature.name, e)
      }
    })
  }

  return (
    <div className="relative w-full h-full">
      {/* Fullscreen Map */}
      <div ref={mapContainer} className="w-full h-full" />
      
      {/* Floating Sidebar Panel from Left */}
      <div
        className={`absolute left-0 top-0 h-full bg-white shadow-2xl transition-transform duration-300 ease-in-out z-[1000] ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
        style={{ width: '320px' }}
      >
        <div className="p-6 h-full flex flex-col">
          {/* Header */}
          <div className="mb-6">
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="absolute -right-10 top-4 bg-white rounded-r-lg px-2 py-4 shadow-lg hover:bg-gray-50 transition-colors"
              aria-label={sidebarOpen ? 'Close sidebar' : 'Open sidebar'}
            >
              {sidebarOpen ? (
                <svg className="w-5 h-5 text-gray-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              ) : (
                <svg className="w-5 h-5 text-gray-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              )}
            </button>
            
            <h1 className="text-2xl font-bold text-gray-900 mb-2">{resortName} Map</h1>
            <p className="text-sm text-gray-600">
              Find all the signs on the map. Green markers indicate signs you've found.
            </p>
            {skiFeatures.length > 0 && (
              <p className="text-xs text-gray-500 mt-2">
                Trails, lifts, and resort boundaries are shown on the map.
              </p>
            )}
          </div>

          {/* Progress Info */}
          <div className="mb-6 p-4 bg-gray-50 rounded-lg">
            <div className="text-sm font-semibold text-gray-700 mb-2">
              Progress: {discoveredSignIds.size} / {signs.length} signs found
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div
                className="bg-green-500 h-2 rounded-full transition-all duration-300"
                style={{ width: `${signs.length > 0 ? (discoveredSignIds.size / signs.length) * 100 : 0}%` }}
              ></div>
            </div>
          </div>

          {/* Buttons */}
          <div className="space-y-3 flex-1">
            <a
              href={`/${resortSlug}/game`}
              className="block w-full px-4 py-3 bg-indigo-600 text-white text-center rounded-lg hover:bg-indigo-700 transition-colors font-medium"
            >
              View Signs List
            </a>
            <a
              href={`/${resortSlug}/game`}
              className="block w-full px-4 py-3 bg-gray-100 text-gray-700 text-center rounded-lg hover:bg-gray-200 transition-colors font-medium"
            >
              Back to Game
            </a>
          </div>

          {/* Footer */}
          <div className="mt-auto pt-4 border-t border-gray-200">
            <p className="text-xs text-gray-500 text-center">
              Use the map controls to zoom and pan
            </p>
          </div>
        </div>
      </div>

      {/* Legend Bubble at Bottom of Map */}
      <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 bg-white rounded-lg shadow-xl p-4 z-[999] max-w-md">
        <div className="flex flex-col gap-3">
          {/* Sign Markers */}
          <div className="flex items-center gap-4 text-xs">
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded-full bg-green-500 border-2 border-white shadow"></div>
              <span className="text-gray-700">Found Sign</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded-full bg-gray-500 border-2 border-white shadow"></div>
              <span className="text-gray-700">Not Found</span>
            </div>
          </div>
          
          {/* Trail Types */}
          {skiFeatures.length > 0 && (
            <div className="flex flex-wrap items-center gap-3 text-xs pt-2 border-t border-gray-200">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 bg-green-600 border border-gray-800"></div>
                <span className="text-gray-700">Green Trail</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 bg-blue-600 border border-gray-800"></div>
                <span className="text-gray-700">Blue Trail</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 bg-black border border-gray-800"></div>
                <span className="text-gray-700">Black Trail</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 bg-red-600 border border-gray-800" style={{ borderStyle: 'dashed' }}></div>
                <span className="text-gray-700">Lift</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 border-2 border-black border-dashed"></div>
                <span className="text-gray-700">Boundary</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
