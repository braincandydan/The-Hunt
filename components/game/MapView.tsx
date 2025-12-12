'use client'

import { useEffect, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { Sign, GeoJSONGeometry } from '@/lib/utils/types'

// Dynamic import of MapView3D to avoid loading Three.js (~40MB) until 3D mode is used
const MapView3D = dynamic(() => import('./MapView3D'), {
  loading: () => (
    <div className="w-full h-full flex items-center justify-center bg-gray-100">
      <div className="flex flex-col items-center gap-4">
        <div className="w-12 h-12 border-4 border-gray-200 border-t-indigo-600 rounded-full animate-spin" />
        <p className="text-gray-600 font-medium">Loading 3D view...</p>
      </div>
    </div>
  ),
  ssr: false
})

interface MapViewProps {
  resortSlug: string
  signs: Sign[]
  discoveredSignIds: Set<string>
  skiFeatures?: Array<{
    id: string
    name: string
    type: 'trail' | 'lift' | 'boundary' | 'area' | 'road'
    difficulty?: string
    geometry: GeoJSONGeometry
    status?: string
    metadata?: Record<string, unknown> // Metadata including elevation data
  }>
  resortName?: string
  onSpeedUpdate?: (speedData: { current: number | null; top: number; average: number }) => void
  // Callback for location tracking updates (for run tracking)
  onLocationUpdate?: (location: { lat: number; lng: number; altitude?: number; speed?: number } | null, isTracking: boolean) => void
  // Optional: Path to qgisthreejs 3D scene export
  scene3DUrl?: string // e.g., '/3d-map/index.html' or '/3d-map/scene.json'
  // Optional: Center coordinates for 3D scene
  scene3DCenter?: [number, number] // [lat, lng]
  // Optional: Paths to additional GeoJSON files from QGIS exports
  additionalGeoJSONPaths?: string[] // e.g., ['/3d-map/geojson/tree-line.json', '/3d-map/geojson/runs.json']
}

export default function MapView({ resortSlug, signs, discoveredSignIds, skiFeatures = [], resortName = 'Resort', onSpeedUpdate, onLocationUpdate, scene3DUrl, scene3DCenter, additionalGeoJSONPaths }: MapViewProps) {
  // DEBUG: Track component renders
  const renderCountRef = useRef(0)
  renderCountRef.current++
  if (process.env.NODE_ENV === 'development') {
    console.log(`[RENDER #${renderCountRef.current}] MapView component rendering`)
  }
  
  const [viewMode, setViewMode] = useState<'2d' | '3d'>('2d') // Toggle between 2D and 3D-Three.js
  const mapContainer = useRef<HTMLDivElement>(null)
  const map = useRef<any>(null) // Use any to avoid type issues before Leaflet loads
  const markersRef = useRef<any[]>([])
  const layersRef = useRef<any[]>([])
  const labelsRef = useRef<any[]>([]) // Store fallback label markers
  const arrowsRef = useRef<any[]>([]) // Store arrow markers
  const textpathLayersRef = useRef<Array<{ layer: any; text: string; options: any; color: string }>>([]) // Store layers with textpath labels
  const maskOverlayRef = useRef<any>(null) // Store the grey mask overlay
  const snowOverlayRef = useRef<any>(null) // Store the snow texture overlay
  const tileLayersRef = useRef<any[]>([]) // Store tile layers so we can update their bounds
  const layerControlRef = useRef<any>(null) // Store the layer control so we can update it
  const [currentZoom, setCurrentZoom] = useState(13) // Track zoom level
  const [showLayerMenu, setShowLayerMenu] = useState(false) // Track layer menu visibility
  const [activeBaseLayer, setActiveBaseLayer] = useState<'snowy' | 'standard' | 'terrain' | 'satellite'>('snowy') // Track active base layer
  const [showHillshade, setShowHillshade] = useState(false) // Track hillshade overlay visibility
  const [hillshadeType, setHillshadeType] = useState<'esri' | 'esri-dark' | 'esri-shaded' | 'esri-terrain3d' | 'stadia'>('esri') // Which hillshade to use
  const hillshadeLayerRef = useRef<any>(null) // Store hillshade overlay layer
  const [leafletLoaded, setLeafletLoaded] = useState(false)
  const MIN_ZOOM_FOR_LABELS = 15 // Only show labels when zoomed in enough
  const [isTrackingLocation, setIsTrackingLocation] = useState(false) // Track if location is being watched
  const [userLocation, setUserLocation] = useState<[number, number] | null>(null) // Store user's current location
  const [userSpeed, setUserSpeed] = useState<number | null>(null) // Store user's current speed in km/h
  const [topSpeed, setTopSpeed] = useState<number>(0) // Store top speed in km/h
  const [speedHistory, setSpeedHistory] = useState<number[]>([]) // Store speed history for average calculation
  const [locationError, setLocationError] = useState<string | null>(null) // Store location errors
  const userLocationMarkerRef = useRef<any>(null) // Reference to the user location marker
  const locationWatchIdRef = useRef<number | null>(null) // Reference to the watchPosition ID
  const hasCenteredOnUserRef = useRef(false) // Track if we've centered on user location already
  const isMountedRef = useRef(true) // Track if component is mounted
  const shouldTrackLocationRef = useRef(false) // Track desired tracking state (avoids closure issues)

  // Track plugin loading states
  const esriLeafletLoadedRef = useRef(false)
  const textpathLoadedRef = useRef(false)
  
  // Track component mount state to prevent operations after unmount
  useEffect(() => {
    isMountedRef.current = true
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/fc98da6b-d1d3-4e78-9f6b-0a88a8cf2d28',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'MapView.tsx:92',message:'component mounted',data:{},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'F'})}).catch(()=>{});
    // #endregion
    return () => {
      isMountedRef.current = false
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/fc98da6b-d1d3-4e78-9f6b-0a88a8cf2d28',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'MapView.tsx:96',message:'component unmounting',data:{markerExists:!!userLocationMarkerRef.current},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'F'})}).catch(()=>{});
      // #endregion
    }
  }, [])
  
  // Store last reported altitude for location callback
  const lastAltitudeRef = useRef<number | undefined>(undefined)
  
  // Store callback ref to avoid re-running effect on callback change
  const onLocationUpdateRef = useRef(onLocationUpdate)
  onLocationUpdateRef.current = onLocationUpdate
  
  // Throttle location updates to parent (max once per second)
  const lastLocationUpdateTimeRef = useRef<number>(0)
  
  // Throttle state updates to prevent excessive re-renders
  const lastStateUpdateTimeRef = useRef<number>(0)
  const STATE_UPDATE_THROTTLE = 2000 // Update state max once per 2 seconds

  // Store location in ref to avoid effect dependencies
  const userLocationRef = useRef(userLocation)
  const userSpeedRef = useRef(userSpeed)
  userLocationRef.current = userLocation
  userSpeedRef.current = userSpeed
  
  // Report tracking state changes to parent (not location updates - those happen in watchPosition callback)
  useEffect(() => {
    console.log('[EFFECT] Tracking state changed effect running', { isTrackingLocation, hasCallback: !!onLocationUpdateRef.current })
    
    if (!onLocationUpdateRef.current) return
    
    // Report tracking state changes immediately
    if (!isTrackingLocation) {
      console.log('[EFFECT] Tracking disabled, sending null to parent')
      onLocationUpdateRef.current(null, false)
      lastLocationUpdateTimeRef.current = 0 // Reset throttle
    }
    // Don't send location here - it's sent from watchPosition callback
  }, [isTrackingLocation]) // Only run when tracking state changes
  
  // REMOVED: Periodic update - it was causing constant re-renders
  // Location updates are already handled by the throttled effect above
  
  // Ensure marker is visible when we have location and tracking is active
  // Only create marker once when tracking starts - position updates happen in the watchPosition callback
  useEffect(() => {
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/fc98da6b-d1d3-4e78-9f6b-0a88a8cf2d28',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'MapView.tsx:137',message:'marker creation effect running',data:{isTrackingLocation,hasUserLocation:!!userLocation,hasMap:!!map.current,leafletLoaded,markerExists:!!userLocationMarkerRef.current},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'F'})}).catch(()=>{});
    // #endregion
    if (!isTrackingLocation || !userLocation || !map.current || !leafletLoaded) {
      return
    }
    
    // If marker already exists, don't recreate it (position updates happen in watchPosition callback)
    if (userLocationMarkerRef.current) {
      // #region agent log
      const isOnMap = map.current.hasLayer(userLocationMarkerRef.current)
      fetch('http://127.0.0.1:7242/ingest/fc98da6b-d1d3-4e78-9f6b-0a88a8cf2d28',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'MapView.tsx:144',message:'marker already exists check',data:{markerExists:!!userLocationMarkerRef.current,isOnMap},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'F'})}).catch(()=>{});
      // #endregion
      return
    }
    
    const L = (window as any).L
    if (!L) return
    
    // Wait a tick to ensure map is fully ready
    const timeoutId = setTimeout(() => {
      if (!map.current || !isTrackingLocation || !userLocation) return
      
      // Check if map container exists
      try {
        const container = map.current.getContainer()
        if (!container || !container.parentElement) {
          return
        }
      } catch (err) {
        return
      }
      
      // Create marker once
      if (!userLocationMarkerRef.current) {
        try {
          const location: [number, number] = userLocation
          if (process.env.NODE_ENV === 'development') {
            console.log('Creating marker immediately from existing location:', location)
          }
          
          const redIcon = L.divIcon({
            className: 'user-location-marker-div',
            html: '<div style="width: 30px; height: 30px; background-color: #FF0000; border: 4px solid #FFFFFF; border-radius: 50%; box-shadow: 0 0 0 4px rgba(255, 0, 0, 0.5), 0 0 20px rgba(255, 0, 0, 0.8); animation: pulse 2s infinite;"></div>',
            iconSize: [30, 30],
            iconAnchor: [15, 15],
          })
          
          userLocationMarkerRef.current = L.marker(location, {
            icon: redIcon,
            zIndexOffset: 10000,
            riseOnHover: false,
          })
          userLocationMarkerRef.current.addTo(map.current)
          
          // Set z-index on element
          const markerElement = userLocationMarkerRef.current.getElement()
          if (markerElement) {
            markerElement.style.zIndex = '10000'
          }
          
          if (process.env.NODE_ENV === 'development') {
            console.log('Marker created successfully, on map:', map.current.hasLayer(userLocationMarkerRef.current))
          }
        } catch (err) {
          console.error('Failed to create marker from existing location:', err)
        }
      }
    }, 50) // Small delay to avoid map transition conflicts
    
    return () => clearTimeout(timeoutId)
  }, [isTrackingLocation, leafletLoaded]) // Removed userLocation - marker position updates happen in watchPosition callback

  // Load Leaflet only on client side - plugins loaded on-demand
  useEffect(() => {
    if (typeof window === 'undefined') return
    
    const loadLeaflet = async () => {
      const L = (await import('leaflet')).default
      // @ts-ignore - CSS import
      await import('leaflet/dist/leaflet.css')
      
      // Fix Leaflet default marker icon issue with Next.js
      delete (L.Icon.Default.prototype as any)._getIconUrl
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
        iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
        shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
      })
      
      // Store L in window for use in other effects
      ;(window as any).L = L
      setLeafletLoaded(true)
    }
    
    loadLeaflet()
  }, [])

  // Load leaflet-textpath plugin on-demand
  const loadTextpathPlugin = async () => {
    if (textpathLoadedRef.current) return true
    try {
      // @ts-ignore - leaflet-textpath doesn't have types
      await import('leaflet-textpath')
      textpathLoadedRef.current = true
      return true
    } catch {
      return false
    }
  }

  // Load esri-leaflet plugin on-demand
  const loadEsriLeafletPlugin = async () => {
    if (esriLeafletLoadedRef.current) return true
    try {
      // @ts-ignore - esri-leaflet for dynamic ESRI services
      await import('esri-leaflet')
      esriLeafletLoadedRef.current = true
      return true
    } catch {
      return false
    }
  }

  useEffect(() => {
    if (!mapContainer.current || map.current || !leafletLoaded || typeof window === 'undefined') return
    
    const L = (window as any).L
    if (!L) return

    // Calculate center from signs, ski features, or use a reasonable default
    let center: [number, number]
    let zoom = 14

    if (signs.length > 0) {
      // Calculate center from signs
      const avgLat = signs.reduce((sum, s) => sum + parseFloat(s.lat.toString()), 0) / signs.length
      const avgLng = signs.reduce((sum, s) => sum + parseFloat(s.lng.toString()), 0) / signs.length
      center = [avgLat, avgLng]
      zoom = 13
    } else if (skiFeatures.length > 0) {
      // Calculate center from ski features if no signs
      // Try to find the boundary first for best centering
      const boundaryFeature = skiFeatures.find(f => f.type === 'boundary')
      if (boundaryFeature && boundaryFeature.geometry) {
        try {
          const coords = boundaryFeature.geometry.type === 'Polygon' 
            ? boundaryFeature.geometry.coordinates[0]
            : boundaryFeature.geometry.type === 'MultiPolygon'
              ? boundaryFeature.geometry.coordinates[0][0]
              : []
          if (coords.length > 0) {
            const avgLng = coords.reduce((sum: number, c: number[]) => sum + c[0], 0) / coords.length
            const avgLat = coords.reduce((sum: number, c: number[]) => sum + c[1], 0) / coords.length
            center = [avgLat, avgLng]
          } else {
            center = [0, 0] // Will be overwritten by fitBounds
          }
        } catch {
          center = [0, 0]
        }
      } else {
        center = [0, 0] // Will be overwritten by fitBounds
      }
    } else {
      // No data available - use a neutral center that will be overwritten
      center = [0, 0]
      zoom = 2 // World view until we have data
    }

    map.current = L.map(mapContainer.current, {
      center,
      zoom,
      zoomSnap: 0, // No snapping - allows completely smooth continuous zoom
      zoomDelta: 1.0, // Standard zoom steps for natural feel
      wheelPxPerZoomLevel: 30, // Faster zoom response (lower = faster)
      fadeAnimation: true, // Smooth fade transitions
      zoomAnimation: true, // Enable zoom animations
      zoomAnimationThreshold: 4, // Animate zoom if difference is less than 4 levels
    })

    // Helper function to apply snowy CSS filters to tiles
    const applySnowyStyling = (layer: any) => {
      layer.on('tileload', (e: any) => {
        const img = e.tile as HTMLImageElement
        // Make it look snowy: brighten, desaturate greens, add cool tones
        img.style.filter = 'brightness(1.25) contrast(0.95) saturate(0.35) hue-rotate(-12deg)'
      })
    }

    // Use CartoDB Positron as primary base (light, clean, reliable)
    const snowyBase = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, © <a href="https://carto.com/attributions">CARTO</a>',
      maxZoom: 19,
    })
    applySnowyStyling(snowyBase)

    // OpenStreetMap as fallback/alternative
    const osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19,
    })
    applySnowyStyling(osm)

    // OpenTopoMap with terrain/hillshade (no snowy styling - it has its own terrain shading)
    const terrain = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, © <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)',
      maxZoom: 17,
    })

    // ESRI World Imagery - high-resolution satellite imagery
    const satellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      attribution: '© <a href="https://www.esri.com">Esri</a>, Maxar, Earthstar Geographics',
      maxZoom: 19,
    })

    // Hillshade overlay will be created on-demand when toggled
    // This avoids loading tiles until needed

    // Store tile layers for later bounds updates
    tileLayersRef.current = [snowyBase, osm, terrain, satellite]

    // Add snowy base layer
    snowyBase.addTo(map.current)

    // Layer control for switching base maps (hidden - we'll use custom UI instead)
    const baseMaps = {
      'Snowy Map': snowyBase,
      'Standard Map': osm,
      'Terrain Map': terrain,
    }
    
    // Create layer control but position it off-screen so it's hidden
    // We'll use a custom UI button instead
    const layerControl = L.control.layers(baseMaps, undefined, { position: 'topright' })
    // Don't add to map - we'll handle layer switching via custom UI
    layerControlRef.current = layerControl

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
    
    // Update label visibility after features are loaded
    if (map.current) {
      updateLabelVisibility(map.current.getZoom())
    }

    return () => {
      // Cleanup location tracking (only if component is unmounting, not just re-rendering)
      // Don't remove marker here - it's managed by the location tracking effect
      if (locationWatchIdRef.current !== null) {
        navigator.geolocation.clearWatch(locationWatchIdRef.current)
        locationWatchIdRef.current = null
      }
      // Don't remove marker in map cleanup - let the location tracking effect handle it
      // The marker will be removed when tracking is disabled or component unmounts

      // Cleanup
      if (map.current) {
        const L = (window as any).L
        if (L) {
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
          if (snowOverlayRef.current && map.current?.hasLayer(snowOverlayRef.current)) {
            map.current.removeLayer(snowOverlayRef.current)
          }
          snowOverlayRef.current = null
          if (hillshadeLayerRef.current && map.current?.hasLayer(hillshadeLayerRef.current)) {
            map.current.removeLayer(hillshadeLayerRef.current)
          }
          hillshadeLayerRef.current = null
        }
        map.current.remove()
        map.current = null
      }
    }
  }, [leafletLoaded, signs, skiFeatures])

  useEffect(() => {
    if (map.current && leafletLoaded && typeof window !== 'undefined') {
      const L = (window as any).L
      if (L) {
        // Update markers when discoveredSignIds changes
        // IMPORTANT: Check refs at the right time - marker might be created asynchronously
        // Check refs AFTER removing sign markers to ensure we have the latest marker reference
        const wasUserMarkerOnMap = userLocationMarkerRef.current && map.current?.hasLayer(userLocationMarkerRef.current)
        
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/fc98da6b-d1d3-4e78-9f6b-0a88a8cf2d28',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'MapView.tsx:457',message:'removing all markers for update',data:{userMarkerExists:!!userLocationMarkerRef.current,wasOnMap:wasUserMarkerOnMap},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
        // #endregion
        
        // Temporarily remove user marker to protect it from being removed by marker.remove()
        if (userLocationMarkerRef.current && map.current?.hasLayer(userLocationMarkerRef.current)) {
          map.current.removeLayer(userLocationMarkerRef.current)
        }
        const userAccuracyCircle = userLocationMarkerRef.current ? (userLocationMarkerRef.current as any).accuracyCircle : null
        if (userAccuracyCircle && map.current?.hasLayer(userAccuracyCircle)) {
          map.current.removeLayer(userAccuracyCircle)
        }
        
        // Remove sign markers (not user location marker)
        markersRef.current.forEach((marker) => marker.remove())
        markersRef.current = []
        addMarkers()
        
        // Re-add user location marker if it exists
        // Check refs AGAIN after removing markers - marker might have been created in the meantime
        const userMarker = userLocationMarkerRef.current // Re-check ref - might have been set by watchPosition callback
        const shouldTrack = shouldTrackLocationRef.current
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/fc98da6b-d1d3-4e78-9f6b-0a88a8cf2d28',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'MapView.tsx:480',message:'checking if should re-add marker',data:{isTrackingLocation,shouldTrack,hasUserMarker:!!userMarker,hasMap:!!map.current},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
        // #endregion
        // Re-add marker if it exists - the marker itself indicates tracking was active
        // Use ref to check tracking state (persists across re-renders)
        if (shouldTrack && userMarker && map.current) {
          // #region agent log
          const isOnMapBeforeReadd = map.current.hasLayer(userMarker)
          fetch('http://127.0.0.1:7242/ingest/fc98da6b-d1d3-4e78-9f6b-0a88a8cf2d28',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'MapView.tsx:482',message:'re-adding user marker',data:{markerExists:!!userMarker,isOnMapBefore:isOnMapBeforeReadd},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
          // #endregion
          if (!isOnMapBeforeReadd) {
            userMarker.addTo(map.current)
            const markerElement = userMarker.getElement()
            if (markerElement) {
              markerElement.style.zIndex = '10000'
            }
            // #region agent log
            const isOnMapAfterReadd = map.current.hasLayer(userMarker)
            fetch('http://127.0.0.1:7242/ingest/fc98da6b-d1d3-4e78-9f6b-0a88a8cf2d28',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'MapView.tsx:490',message:'after re-adding marker',data:{isOnMap:isOnMapAfterReadd},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
            // #endregion
          }
          if (userAccuracyCircle && !map.current.hasLayer(userAccuracyCircle)) {
            userAccuracyCircle.addTo(map.current)
          }
        } else {
          // #region agent log
          fetch('http://127.0.0.1:7242/ingest/fc98da6b-d1d3-4e78-9f6b-0a88a8cf2d28',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'MapView.tsx:504',message:'NOT re-adding marker - conditions not met',data:{isTrackingLocation,shouldTrack,hasUserMarker:!!userMarker,hasMap:!!map.current},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
          // #endregion
        }
      }
    }
  }, [discoveredSignIds, leafletLoaded]) // Removed isTrackingLocation - use ref instead to avoid stale closures

  // Location tracking effect
  useEffect(() => {
    console.log('[EFFECT] Location tracking effect running', { isTrackingLocation, leafletLoaded, window: typeof window })
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/fc98da6b-d1d3-4e78-9f6b-0a88a8cf2d28',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'MapView.tsx:477',message:'location tracking effect running',data:{isTrackingLocation,leafletLoaded,markerExists:!!userLocationMarkerRef.current},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'F'})}).catch(()=>{});
    // #endregion
    
    // Update ref to track desired state
    shouldTrackLocationRef.current = isTrackingLocation
    
    // Early exit conditions - don't start tracking if prerequisites aren't met
    if (!leafletLoaded || typeof window === 'undefined') {
      console.log('[EFFECT] Early exit - prerequisites not met')
      return
    }

    const L = (window as any).L
    if (!L) return

    // Handle tracking state changes
    if (!isTrackingLocation) {
      console.log('[EFFECT] Tracking disabled, cleaning up...')
      // Clean up when tracking is disabled
      if (locationWatchIdRef.current !== null) {
        navigator.geolocation.clearWatch(locationWatchIdRef.current)
        locationWatchIdRef.current = null
      }
      if (userLocationMarkerRef.current && map.current) {
      console.log('[EFFECT] Removing marker (tracking disabled)')
      // #region agent log
      const markerBeforeRemove = !!userLocationMarkerRef.current
      const wasOnMapBeforeRemove = markerBeforeRemove && map.current?.hasLayer(userLocationMarkerRef.current)
      fetch('http://127.0.0.1:7242/ingest/fc98da6b-d1d3-4e78-9f6b-0a88a8cf2d28',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'MapView.tsx:520',message:'removing marker - tracking disabled',data:{markerExists:markerBeforeRemove,wasOnMap:wasOnMapBeforeRemove,isTrackingLocation},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
      // #endregion
      if ((userLocationMarkerRef.current as any).accuracyCircle) {
        map.current.removeLayer((userLocationMarkerRef.current as any).accuracyCircle)
      }
      if (userLocationMarkerRef.current) {
        map.current.removeLayer(userLocationMarkerRef.current)
      }
      userLocationMarkerRef.current = null
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/fc98da6b-d1d3-4e78-9f6b-0a88a8cf2d28',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'MapView.tsx:535',message:'marker removed - ref set to null',data:{markerExists:!!userLocationMarkerRef.current},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
      // #endregion
      }
      // Reset the centered flag so we center again next time
      hasCenteredOnUserRef.current = false
      setUserLocation(null)
      setUserSpeed(null)
      return // Exit early - don't start tracking
    }
    
    // Tracking is enabled - start watchPosition
    console.log('[EFFECT] Tracking enabled, starting watchPosition...')

    // Don't start tracking if map isn't ready
    if (!map.current) {
      return
    }

    // Check if geolocation is available
    if (!navigator.geolocation) {
      setLocationError('Geolocation is not supported by your browser')
      setIsTrackingLocation(false)
      return
    }
    
    // Already watching - don't start again
    if (locationWatchIdRef.current !== null) {
      // But ensure marker is visible if it exists
      if (userLocationMarkerRef.current && map.current) {
        if (!map.current.hasLayer(userLocationMarkerRef.current)) {
          userLocationMarkerRef.current.addTo(map.current)
          const markerElement = userLocationMarkerRef.current.getElement()
          if (markerElement) {
            markerElement.style.zIndex = '10000'
          }
        }
      }
      return
    }

    // Capture map reference for use in callbacks
    const mapInstance = map.current

    // Start watching position
    locationWatchIdRef.current = navigator.geolocation.watchPosition(
      (position) => {
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/fc98da6b-d1d3-4e78-9f6b-0a88a8cf2d28',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'MapView.tsx:547',message:'watchPosition callback called',data:{hasMounted:isMountedRef.current,hasMap:!!map.current},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
        // #endregion
        console.log('[WATCHPOSITION] Location received, checking guards...')
        
        // Guard: Check if component is still mounted and map exists
        if (!isMountedRef.current || !map.current) {
          // #region agent log
          fetch('http://127.0.0.1:7242/ingest/fc98da6b-d1d3-4e78-9f6b-0a88a8cf2d28',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'MapView.tsx:551',message:'watchPosition guards failed',data:{isMounted:isMountedRef.current,hasMap:!!map.current},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
          // #endregion
          if (process.env.NODE_ENV === 'development') {
            console.warn('[WATCHPOSITION] Location update skipped - component unmounted or map not ready')
          }
          return
        }
        
        console.log('[WATCHPOSITION] Guards passed, processing location...')
        const { latitude, longitude, accuracy, speed, altitude } = position.coords
        const location: [number, number] = [latitude, longitude]
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/fc98da6b-d1d3-4e78-9f6b-0a88a8cf2d28',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'MapView.tsx:560',message:'location extracted',data:{lat:latitude,lng:longitude},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
        // #endregion
        
        // Always update refs immediately (no re-render)
        userLocationRef.current = location
        if (altitude !== null) {
          lastAltitudeRef.current = altitude
        }
        
        // Send location update to parent (throttled, no state update = no re-render)
        const now = Date.now()
        if (onLocationUpdateRef.current && (now - lastLocationUpdateTimeRef.current >= 1000)) {
          lastLocationUpdateTimeRef.current = now
          console.log('[LOCATION] Sending update to parent (throttled)', location)
          onLocationUpdateRef.current({
            lat: location[0],
            lng: location[1],
            altitude: lastAltitudeRef.current,
            speed: userSpeedRef.current || undefined
          }, true)
        }
        
        // Throttle state updates to prevent excessive re-renders
        const timeSinceLastStateUpdate = now - lastStateUpdateTimeRef.current
        
        // Only update state if enough time has passed (throttled to prevent flickering)
        if (timeSinceLastStateUpdate >= STATE_UPDATE_THROTTLE) {
          lastStateUpdateTimeRef.current = now
          console.log('[LOCATION] Setting userLocation state (throttled)', location, `after ${timeSinceLastStateUpdate}ms`)
          setUserLocation(location)
          setLocationError(null)
        }

        // Convert speed from m/s to km/h (speed can be null if not available)
        // Store in ref immediately (no re-render)
        if (speed !== null && speed !== undefined && !isNaN(speed)) {
          const speedKmh = speed * 3.6 // Convert m/s to km/h
          userSpeedRef.current = speedKmh
          
          // Only update state if enough time has passed (throttled)
          if (timeSinceLastStateUpdate >= STATE_UPDATE_THROTTLE) {
            setUserSpeed(speedKmh)
            
            // Update speed history
            setSpeedHistory((prevHistory) => {
              return [...prevHistory, speedKmh].slice(-100) // Keep last 100 readings
            })
            
            // Update top speed
            setTopSpeed((prevTop) => {
              return speedKmh > prevTop ? speedKmh : prevTop
            })
          }
        } else {
          userSpeedRef.current = null
          // Only update state if throttled
          if (timeSinceLastStateUpdate >= STATE_UPDATE_THROTTLE) {
            setUserSpeed(null)
          }
        }

        // Guard: Double-check map still exists and is ready before Leaflet operations
        const currentMap = map.current
        if (!currentMap) {
          console.warn('[MARKER] Map not available, skipping marker update')
          return
        }
        
        // Check if map container still exists in DOM
        try {
          const container = currentMap.getContainer()
          if (!container || !container.parentElement) {
            if (process.env.NODE_ENV === 'development') {
              console.warn('[MARKER] Map container not in DOM, skipping marker update')
            }
            return
          }
        } catch (err) {
          console.error('[MARKER] Error checking map container:', err)
          // Map might be destroyed
          return
        }
        
        console.log('[MARKER] About to create/update marker, current marker exists:', !!userLocationMarkerRef.current)
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/fc98da6b-d1d3-4e78-9f6b-0a88a8cf2d28',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'MapView.tsx:641',message:'marker creation check',data:{markerExists:!!userLocationMarkerRef.current,mapExists:!!currentMap,location},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
        // #endregion
        try {
          // Always ensure marker exists and is on the map when tracking is enabled
          if (!userLocationMarkerRef.current) {
            console.log('[MARKER] Creating location marker at:', location)
            // #region agent log
            fetch('http://127.0.0.1:7242/ingest/fc98da6b-d1d3-4e78-9f6b-0a88a8cf2d28',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'MapView.tsx:645',message:'marker creation starting',data:{location},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
            // #endregion
            
            // Create a DIV icon marker for maximum visibility and control
            const redIcon = L.divIcon({
              className: 'user-location-marker-div',
              html: '<div style="width: 30px; height: 30px; background-color: #FF0000; border: 4px solid #FFFFFF; border-radius: 50%; box-shadow: 0 0 0 4px rgba(255, 0, 0, 0.5), 0 0 20px rgba(255, 0, 0, 0.8); animation: pulse 2s infinite;"></div>',
              iconSize: [30, 30],
              iconAnchor: [15, 15],
            })
            
            // Create marker with the custom icon
            userLocationMarkerRef.current = L.marker(location, {
              icon: redIcon,
              zIndexOffset: 10000,
              riseOnHover: false,
            })
            
            console.log('[MARKER] Marker created, adding to map...')
            // #region agent log
            fetch('http://127.0.0.1:7242/ingest/fc98da6b-d1d3-4e78-9f6b-0a88a8cf2d28',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'MapView.tsx:664',message:'before addTo',data:{markerCreated:!!userLocationMarkerRef.current},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
            // #endregion
            // Add to map immediately
            userLocationMarkerRef.current.addTo(currentMap)
            // #region agent log
            const isOnMapAfterAdd = currentMap.hasLayer(userLocationMarkerRef.current)
            fetch('http://127.0.0.1:7242/ingest/fc98da6b-d1d3-4e78-9f6b-0a88a8cf2d28',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'MapView.tsx:666',message:'after addTo',data:{isOnMap:isOnMapAfterAdd},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
            // #endregion
            
            // Ensure marker is on top by setting z-index on the icon element
            const markerElement = userLocationMarkerRef.current.getElement()
            if (markerElement) {
              markerElement.style.zIndex = '10000'
              // #region agent log
              const computedStyle = window.getComputedStyle(markerElement)
              fetch('http://127.0.0.1:7242/ingest/fc98da6b-d1d3-4e78-9f6b-0a88a8cf2d28',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'MapView.tsx:670',message:'marker element styles',data:{zIndex:markerElement.style.zIndex,display:computedStyle.display,opacity:computedStyle.opacity,visibility:computedStyle.visibility},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
              // #endregion
              console.log('[MARKER] Marker element found, z-index set:', markerElement.style.zIndex)
            } else {
              // #region agent log
              fetch('http://127.0.0.1:7242/ingest/fc98da6b-d1d3-4e78-9f6b-0a88a8cf2d28',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'MapView.tsx:672',message:'marker element NOT found',data:{},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
              // #endregion
              console.error('[MARKER] Marker element NOT found!')
            }
            
            const isOnMap = currentMap.hasLayer(userLocationMarkerRef.current)
            const markerPos = userLocationMarkerRef.current.getLatLng()
            const mapBounds = currentMap.getBounds()
            const mapCenter = currentMap.getCenter()
            // #region agent log
            fetch('http://127.0.0.1:7242/ingest/fc98da6b-d1d3-4e78-9f6b-0a88a8cf2d28',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'MapView.tsx:677',message:'marker position and map bounds',data:{isOnMap,markerPos:{lat:markerPos.lat,lng:markerPos.lng},mapBounds:{south:mapBounds.getSouth(),north:mapBounds.getNorth(),east:mapBounds.getEast(),west:mapBounds.getWest()},mapCenter:{lat:mapCenter.lat,lng:mapCenter.lng},inBounds:mapBounds.contains(markerPos)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
            // #endregion
            console.log('[MARKER] Marker on map:', isOnMap)
            console.log('[MARKER] Marker position:', markerPos)

            // Add accuracy circle
            const accuracyCircle = L.circle(location, {
              radius: Math.max(accuracy || 20, 20), // Minimum 20m radius
              fillColor: '#3388ff',
              color: '#3388ff',
              weight: 2,
              opacity: 0.4,
              fillOpacity: 0.15,
              className: 'user-location-accuracy',
            })
            accuracyCircle.addTo(currentMap)

            // Store accuracy circle reference in the marker (for cleanup)
            ;(userLocationMarkerRef.current as any).accuracyCircle = accuracyCircle
            
            // #region agent log
            fetch('http://127.0.0.1:7242/ingest/fc98da6b-d1d3-4e78-9f6b-0a88a8cf2d28',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'MapView.tsx:694',message:'marker creation complete',data:{markerExists:!!userLocationMarkerRef.current,isOnMap:currentMap.hasLayer(userLocationMarkerRef.current)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
            // #endregion
            console.log('[MARKER] Marker creation complete')
          } else {
            // Ensure marker is still on the map (in case it was removed)
            const isOnMap = currentMap.hasLayer(userLocationMarkerRef.current)
            // #region agent log
            fetch('http://127.0.0.1:7242/ingest/fc98da6b-d1d3-4e78-9f6b-0a88a8cf2d28',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'MapView.tsx:697',message:'marker update check',data:{markerExists:!!userLocationMarkerRef.current,isOnMap},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
            // #endregion
            if (!isOnMap) {
              // #region agent log
              fetch('http://127.0.0.1:7242/ingest/fc98da6b-d1d3-4e78-9f6b-0a88a8cf2d28',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'MapView.tsx:700',message:'marker was removed - re-adding',data:{},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
              // #endregion
              if (process.env.NODE_ENV === 'development') {
                console.warn('Marker was removed from map, re-adding...')
              }
              userLocationMarkerRef.current.addTo(currentMap)
              if (userLocationMarkerRef.current.setZIndexOffset) {
                userLocationMarkerRef.current.setZIndexOffset(10000)
              }
              const markerElement = userLocationMarkerRef.current.getElement()
              if (markerElement) {
                markerElement.style.zIndex = '10000'
              }
              // #region agent log
              const isOnMapAfterReadd = currentMap.hasLayer(userLocationMarkerRef.current)
              fetch('http://127.0.0.1:7242/ingest/fc98da6b-d1d3-4e78-9f6b-0a88a8cf2d28',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'MapView.tsx:710',message:'after re-adding marker',data:{isOnMap:isOnMapAfterReadd},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
              // #endregion
            }
            // Ensure accuracy circle is on the map
            const accuracyCircle = (userLocationMarkerRef.current as any).accuracyCircle
            if (accuracyCircle) {
              if (!currentMap.hasLayer(accuracyCircle)) {
                accuracyCircle.addTo(currentMap)
              }
            }
          }
          
          // Don't auto-center map - user controls map view
          // Just mark that we've seen the first location
          if (!hasCenteredOnUserRef.current) {
            hasCenteredOnUserRef.current = true
          }
          
          // Always update marker position to keep it visible
          if (userLocationMarkerRef.current) {
            console.log('[MARKER] Updating marker position to:', location)
            const isOnMapBefore = currentMap.hasLayer(userLocationMarkerRef.current)
            // #region agent log
            fetch('http://127.0.0.1:7242/ingest/fc98da6b-d1d3-4e78-9f6b-0a88a8cf2d28',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'MapView.tsx:730',message:'updating marker position',data:{isOnMapBefore,location},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
            // #endregion
            userLocationMarkerRef.current.setLatLng(location)
            const isOnMap = currentMap.hasLayer(userLocationMarkerRef.current)
            // #region agent log
            fetch('http://127.0.0.1:7242/ingest/fc98da6b-d1d3-4e78-9f6b-0a88a8cf2d28',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'MapView.tsx:735',message:'after position update',data:{isOnMap},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
            // #endregion
            console.log('[MARKER] Marker on map after update:', isOnMap)
            
            // Ensure z-index is set
            const markerElement = userLocationMarkerRef.current.getElement()
            if (markerElement) {
              markerElement.style.zIndex = '10000'
            }
            
            // Update accuracy circle
            if ((userLocationMarkerRef.current as any).accuracyCircle) {
              const accCircle = (userLocationMarkerRef.current as any).accuracyCircle
              accCircle.setLatLng(location)
              accCircle.setRadius(Math.max(accuracy || 20, 20))
            }
          }
        } catch (err) {
          // Log errors for debugging
          console.error('Location marker update failed:', err)
        }
      },
      (error) => {
        // Guard: Check if component is still mounted
        if (!isMountedRef.current) {
          return
        }
        
        // GeolocationPositionError doesn't serialize well, so extract the message
        const errorCode = error.code
        const errorMsg = error.message || 'Unknown error'
        
        if (process.env.NODE_ENV === 'development') {
          console.warn('Geolocation error:', { code: errorCode, message: errorMsg })
        }
        
        let errorMessage = 'Unable to get your location'
        let shouldStopTracking = false
        
        // GeolocationPositionError codes: 1=PERMISSION_DENIED, 2=POSITION_UNAVAILABLE, 3=TIMEOUT
        switch (errorCode) {
          case 1: // PERMISSION_DENIED
            errorMessage = 'Location permission denied. Please enable location access in your browser settings.'
            shouldStopTracking = true // Only stop on permission denied
            break
          case 2: // POSITION_UNAVAILABLE
            errorMessage = 'Location information is unavailable. Make sure location services are enabled.'
            // Don't stop tracking - might be temporary (e.g., in tunnel)
            break
          case 3: // TIMEOUT
            errorMessage = 'Location request timed out. Retrying...'
            // Don't stop tracking - timeout is often temporary
            break
        }
        
        setLocationError(errorMessage)
        
        // Only stop tracking on permanent errors (permission denied)
        if (shouldStopTracking) {
          setIsTrackingLocation(false)
        }
      },
      {
        enableHighAccuracy: true,
        timeout: 15000, // 15 seconds timeout
        maximumAge: 5000, // Allow positions up to 5 seconds old for faster initial fix
      }
    )

    // Cleanup function - only runs when effect dependencies change or component unmounts
    return () => {
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/fc98da6b-d1d3-4e78-9f6b-0a88a8cf2d28',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'MapView.tsx:845',message:'cleanup function called',data:{shouldTrack:shouldTrackLocationRef.current,markerExists:!!userLocationMarkerRef.current},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
      // #endregion
      // Only clear watch if tracking is actually being disabled (check ref, not closure)
      // IMPORTANT: Don't remove the marker here - it's managed by the watchPosition callback
      // Only clear the watch, the marker will be removed when tracking is actually disabled
      if (!shouldTrackLocationRef.current) {
        if (locationWatchIdRef.current !== null) {
          if (process.env.NODE_ENV === 'development') {
            console.log('[CLEANUP] Clearing location watch (tracking disabled)')
          }
          navigator.geolocation.clearWatch(locationWatchIdRef.current)
          locationWatchIdRef.current = null
        }
        
        // Only clean up markers when tracking is actually disabled
        // Don't remove marker here - let the watchPosition callback handle it
        // or remove it in the explicit cleanup when isTrackingLocation becomes false
      } else {
        // Tracking is still active - don't clear the watch, just let effect re-run
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/fc98da6b-d1d3-4e78-9f6b-0a88a8cf2d28',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'MapView.tsx:862',message:'cleanup - tracking still active',data:{shouldTrack:shouldTrackLocationRef.current,markerExists:!!userLocationMarkerRef.current},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
        // #endregion
        if (process.env.NODE_ENV === 'development') {
          console.log('[CLEANUP] Effect re-running but tracking still active - keeping watch and marker')
        }
      }
    }
  }, [isTrackingLocation, leafletLoaded])

  // Update parent component with speed data whenever it changes
  useEffect(() => {
    if (!onSpeedUpdate) return
    
    const avg = speedHistory.length > 0 
      ? speedHistory.reduce((sum, s) => sum + s, 0) / speedHistory.length 
      : 0
    
    onSpeedUpdate({ 
      current: userSpeed, 
      top: topSpeed, 
      average: avg 
    })
  }, [userSpeed, topSpeed, speedHistory, onSpeedUpdate])

  // Switch base layer
  const switchBaseLayer = (layerType: 'snowy' | 'standard' | 'terrain' | 'satellite') => {
    if (!map.current || !leafletLoaded || typeof window === 'undefined') return
    const L = (window as any).L
    if (!L || tileLayersRef.current.length < 4) return

    // Remove current layer
    const currentLayer = tileLayersRef.current.find(layer => map.current?.hasLayer(layer))
    if (currentLayer) {
      map.current.removeLayer(currentLayer)
    }

    // Add new layer based on type
    let newLayer
    if (layerType === 'snowy') {
      newLayer = tileLayersRef.current[0] // CartoDB
    } else if (layerType === 'standard') {
      newLayer = tileLayersRef.current[1] // OSM
    } else if (layerType === 'terrain') {
      newLayer = tileLayersRef.current[2] // Terrain
    } else {
      newLayer = tileLayersRef.current[3] // Satellite
    }

    if (newLayer) {
      newLayer.addTo(map.current)
      setActiveBaseLayer(layerType)
      setShowLayerMenu(false)
    }
  }

  // Create hillshade layer based on type (async to load esri-leaflet on demand)
  const createHillshadeLayer = async (type: 'esri' | 'esri-dark' | 'esri-shaded' | 'esri-terrain3d' | 'stadia', bounds?: any) => {
    if (typeof window === 'undefined') return null
    const L = (window as any).L
    if (!L) return null

    // For esri-terrain3d, load esri-leaflet plugin on demand
    if (type === 'esri-terrain3d') {
      const loaded = await loadEsriLeafletPlugin()
      if (loaded) {
        const esriLeaflet = (L as any).esri
        if (esriLeaflet) {
          try {
            // Use ESRI's World Elevation service with hillshade rendering
            const layer = esriLeaflet.imageMapLayer({
              url: 'https://elevation.arcgis.com/arcgis/rest/services/WorldElevation/Terrain/ImageServer',
              attribution: '© <a href="https://www.esri.com">Esri</a> - High Resolution Terrain',
              opacity: 0.6,
              renderingRule: {
                rasterFunction: 'Hillshade',
                rasterFunctionArguments: {
                  Azimuth: 315,
                  Altitude: 45,
                  ZFactor: 1
                }
              }
            })
            return layer
          } catch {
            // Fall back to standard ESRI hillshade
            type = 'esri'
          }
        }
      }
    }

    const layerConfigs: Record<string, { url: string; attribution: string; maxZoom: number; opacity: number }> = {
      // ESRI World Hillshade - standard grayscale hillshade (varies by region)
      'esri': {
        url: 'https://services.arcgisonline.com/arcgis/rest/services/Elevation/World_Hillshade/MapServer/tile/{z}/{y}/{x}',
        attribution: '© <a href="https://www.esri.com">Esri</a>',
        maxZoom: 23,
        opacity: 0.6,
      },
      // ESRI World Hillshade Dark - darker version with better contrast
      'esri-dark': {
        url: 'https://services.arcgisonline.com/arcgis/rest/services/Elevation/World_Hillshade_Dark/MapServer/tile/{z}/{y}/{x}',
        attribution: '© <a href="https://www.esri.com">Esri</a>',
        maxZoom: 23,
        opacity: 0.5,
      },
      // ESRI World Shaded Relief - colored terrain with elevation shading
      'esri-shaded': {
        url: 'https://services.arcgisonline.com/arcgis/rest/services/World_Shaded_Relief/MapServer/tile/{z}/{y}/{x}',
        attribution: '© <a href="https://www.esri.com">Esri</a>',
        maxZoom: 13,
        opacity: 0.5,
      },
      // Stadia Terrain - consistent quality, artistic style
      'stadia': {
        url: 'https://tiles.stadiamaps.com/tiles/stamen_terrain_background/{z}/{x}/{y}{r}.png',
        attribution: '© <a href="https://stadiamaps.com/">Stadia Maps</a>',
        maxZoom: 18,
        opacity: 0.45,
      },
      // Fallback for esri-terrain3d if esri-leaflet not available
      'esri-terrain3d': {
        url: 'https://services.arcgisonline.com/arcgis/rest/services/Elevation/World_Hillshade/MapServer/tile/{z}/{y}/{x}',
        attribution: '© <a href="https://www.esri.com">Esri</a>',
        maxZoom: 23,
        opacity: 0.6,
      },
    }

    const config = layerConfigs[type] || layerConfigs['esri']
    
    return L.tileLayer(config.url, {
      attribution: config.attribution,
      maxZoom: config.maxZoom,
      bounds: bounds,
      opacity: config.opacity,
      zIndex: 250,
      className: 'hillshade-layer',
    })
  }

  // Toggle hillshade overlay
  const toggleHillshade = async () => {
    if (!map.current || !leafletLoaded || typeof window === 'undefined') return

    if (showHillshade) {
      // Remove hillshade
      if (hillshadeLayerRef.current && map.current.hasLayer(hillshadeLayerRef.current)) {
        map.current.removeLayer(hillshadeLayerRef.current)
      }
      setShowHillshade(false)
    } else {
      // Create and add hillshade layer
      if (!hillshadeLayerRef.current) {
        hillshadeLayerRef.current = await createHillshadeLayer(hillshadeType)
      }
      
      if (hillshadeLayerRef.current) {
        hillshadeLayerRef.current.addTo(map.current)
        hillshadeLayerRef.current.setZIndex(250)
        
        // Apply CSS blend mode for better terrain visibility
        const container = hillshadeLayerRef.current.getContainer()
        if (container) {
          container.style.mixBlendMode = 'multiply'
        }
        
        setShowHillshade(true)
      }
    }
  }

  // Switch hillshade type
  const switchHillshadeType = async (type: 'esri' | 'esri-dark' | 'esri-shaded' | 'esri-terrain3d' | 'stadia') => {
    if (!map.current || !leafletLoaded) return
    
    const wasShowing = showHillshade
    
    // Remove current layer if showing
    if (hillshadeLayerRef.current && map.current.hasLayer(hillshadeLayerRef.current)) {
      map.current.removeLayer(hillshadeLayerRef.current)
    }
    
    // Create new layer of the selected type
    hillshadeLayerRef.current = await createHillshadeLayer(type)
    setHillshadeType(type)
    
    // Re-add if was showing
    if (wasShowing && hillshadeLayerRef.current) {
      hillshadeLayerRef.current.addTo(map.current)
      hillshadeLayerRef.current.setZIndex(250)
      const container = hillshadeLayerRef.current.getContainer()
      if (container) {
        container.style.mixBlendMode = 'multiply'
      }
    }
  }

  // Toggle location tracking
  const toggleLocationTracking = () => {
    if (!navigator.geolocation) {
      setLocationError('Geolocation is not supported by your browser')
      return
    }

    if (isTrackingLocation) {
      // Stop tracking
      if (process.env.NODE_ENV === 'development') {
        console.log('Stopping location tracking')
      }
      setIsTrackingLocation(false)
    } else {
      // Start tracking - request permission first
      navigator.geolocation.getCurrentPosition(
        (position) => {
          // Permission granted, start tracking
          setIsTrackingLocation(true)
          setLocationError(null)
          
          // Immediately set location so marker can be created
          const { latitude, longitude } = position.coords
          setUserLocation([latitude, longitude])
        },
        (error) => {
          // Permission denied or error
          console.error('Location permission error:', error)
          let errorMessage = 'Unable to get your location'
          if (error.code === error.PERMISSION_DENIED) {
            errorMessage = 'Location permission denied. Please enable location access in your browser settings.'
          }
          setLocationError(errorMessage)
        },
        {
          enableHighAccuracy: true,
          timeout: 10000, // Increased timeout
        }
      )
    }
  }

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
      } catch {
        // Textpath update failed, continue
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
  const addTrailLabels = (feature: any, layer: any) => {
    if (!map.current || typeof window === 'undefined') return
    const L = (window as any).L
    if (!L) return
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
        center: true, // Center the text along the path
        offset: 0, // No additional offset when centering
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
      } catch {
        // TextPath not available, use fallback labels
      }
      
      // Fallback: create label at the center of the path
      const midIndex = Math.floor(coords.length / 2)
      if (midIndex < coords.length) {
        const labelPoint: [number, number] = [coords[midIndex][1], coords[midIndex][0]]
        
        // Calculate angle for text rotation
        let bearing = 0
        if (midIndex < coords.length - 1) {
          const point1: [number, number] = [coords[midIndex][1], coords[midIndex][0]]
          const point2: [number, number] = [coords[midIndex + 1][1], coords[midIndex + 1][0]]
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
      // #region agent log
      const userMarkerOnMap = userLocationMarkerRef.current && map.current?.hasLayer(userLocationMarkerRef.current)
      fetch('http://127.0.0.1:7242/ingest/fc98da6b-d1d3-4e78-9f6b-0a88a8cf2d28',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'MapView.tsx:1410',message:'removing ski feature layers',data:{userMarkerExists:!!userLocationMarkerRef.current,isOnMap:userMarkerOnMap},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
      // #endregion
      // Filter out null/undefined layers before removing
      layersRef.current.filter(layer => layer != null).forEach((layer) => {
        try {
          if (map.current?.hasLayer(layer)) {
            map.current.removeLayer(layer)
          }
        } catch (e) {
          // Ignore errors - layer might already be removed
        }
      })
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
        
        // Filter out null/undefined before removing
        labelsRef.current.filter(label => label != null).forEach((label) => {
          try {
            if (map.current?.hasLayer(label)) {
              map.current.removeLayer(label)
            }
          } catch (e) {
            // Ignore errors
          }
        })
        labelsRef.current = []
        arrowsRef.current.filter(arrow => arrow != null).forEach((arrow) => {
          try {
            if (map.current?.hasLayer(arrow)) {
              map.current.removeLayer(arrow)
            }
          } catch (e) {
            // Ignore errors
          }
        })
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
    if (!map.current || typeof window === 'undefined') return
    const L = (window as any).L
    if (!L) return

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
        } catch {
          // Skip features that fail to add to bounds
        }
      })
      
      // Fit map to show all markers and features
      // Disable animation to prevent _leaflet_pos errors during zoom transitions
      if (map.current && bounds.isValid()) {
        try {
          map.current.fitBounds(bounds, {
            padding: [50, 50],
            maxZoom: 15,
            animate: false, // Disable animation to prevent _leaflet_pos errors
          })
        } catch (error) {
          // Fallback: use setView without animation
          if (map.current && bounds.isValid()) {
            const center = bounds.getCenter()
            map.current.setView(center, Math.min(map.current.getZoom(), 15), { animate: false })
          }
        }
      }
    }
  }

  const addSkiFeatures = async () => {
    if (!map.current || skiFeatures.length === 0 || typeof window === 'undefined') return
    const L = (window as any).L
    if (!L) return
    
    // Load textpath plugin for trail labels (lazy load)
    await loadTextpathPlugin()
    
    skiFeatures.forEach((feature, index) => {
      try {
        // Validate geometry
        if (!feature.geometry || !feature.geometry.type || !feature.geometry.coordinates) {
          return // Skip invalid geometry
        }
        
        // Create GeoJSON feature from geometry
        const geoJsonFeature: GeoJSON.Feature = {
          type: 'Feature' as const,
          geometry: feature.geometry,
          properties: {
            name: feature.name,
            type: feature.type,
            difficulty: feature.difficulty,
            status: feature.status,
            metadata: feature.metadata || {}, // Include metadata for elevation data
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

            case 'road':
              // Roads are styled as thin gray lines
              baseStyle.color = '#6b7280' // Tailwind gray-500
              baseStyle.fillColor = '#9ca3af' // Tailwind gray-400
              baseStyle.weight = 2
              baseStyle.opacity = 0.6
              baseStyle.fillOpacity = 0
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
        
        const geoJsonLayer = L.geoJSON(geoJsonFeature, {
          style: () => style, // Use explicit style instead of function
          onEachFeature: (feature: any, layer: L.Layer) => {
            // Add popup with feature info
            const props = feature.properties
            const metadata = props.metadata || {}
            const originalProps = metadata.original_properties || {}
            
            // Extract elevation data
            let elevationInfo = ''
            if (props.type === 'trail') {
              // Try multiple common elevation field names
              const elevation = originalProps.elevation || 
                               originalProps.ele || 
                               originalProps.elevation_max ||
                               originalProps.elevation_min ||
                               originalProps.height
              
              // If we have elevation data, display it
              if (elevation !== undefined && elevation !== null) {
                const elevationMeters = typeof elevation === 'number' ? elevation : parseFloat(elevation)
                if (!isNaN(elevationMeters)) {
                  const elevationFeet = Math.round(elevationMeters * 3.28084)
                  elevationInfo = `<p style="color: #6b7280; font-size: 14px; margin-bottom: 4px;">
                    <strong>Elevation:</strong> ${Math.round(elevationMeters)}m (${elevationFeet}ft)
                  </p>`
                }
              } else {
                // Try to calculate from geometry coordinates (if 3D coordinates exist)
                const coords = feature.geometry.coordinates
                if (coords && Array.isArray(coords)) {
                  // For LineString, check if coordinates have Z values
                  const flatCoords = coords.flat(2)
                  const elevations = flatCoords.filter((_, i) => i % 3 === 2 && typeof flatCoords[i] === 'number')
                  if (elevations.length > 0) {
                    const maxElev = Math.max(...elevations)
                    const minElev = Math.min(...elevations)
                    const maxFeet = Math.round(maxElev * 3.28084)
                    const minFeet = Math.round(minElev * 3.28084)
                    elevationInfo = `<p style="color: #6b7280; font-size: 14px; margin-bottom: 4px;">
                      <strong>Elevation:</strong> ${Math.round(minElev)}m - ${Math.round(maxElev)}m (${minFeet}ft - ${maxFeet}ft)
                    </p>`
                  }
                }
              }
            }
            
            const popupContent = `
              <div style="padding: 8px; min-width: 150px;">
                <h3 style="font-weight: 600; margin-bottom: 4px; font-size: 16px;">${props.name}</h3>
                <p style="color: #6b7280; font-size: 14px; margin-bottom: 4px;">
                  <strong>Type:</strong> ${props.type.charAt(0).toUpperCase() + props.type.slice(1)}
                </p>
                ${props.difficulty ? `<p style="color: #6b7280; font-size: 14px; margin-bottom: 4px;"><strong>Difficulty:</strong> ${props.difficulty}</p>` : ''}
                ${elevationInfo}
                ${props.status ? `<p style="color: #6b7280; font-size: 14px;"><strong>Status:</strong> ${props.status}</p>` : ''}
              </div>
            `
            
            // For boundary polygons, only make the outline interactive (not the fill)
            if (props.type === 'boundary' && (feature.geometry.type === 'Polygon' || feature.geometry.type === 'MultiPolygon')) {
              // Get the outline coordinates
              const outlineCoords = feature.geometry.type === 'Polygon' 
                ? feature.geometry.coordinates[0]
                : feature.geometry.coordinates[0][0]
              
              if (outlineCoords) {
                // Convert GeoJSON [lng, lat] to Leaflet [lat, lng]
                const latLngs = outlineCoords.map((coord: number[]) => [coord[1], coord[0]]) as [number, number][]
                
                // Create a polyline for the outline that will be interactive
                const outlineLayer = L.polyline(latLngs, {
                  color: style.color || '#000000',
                  weight: style.weight || 2,
                  opacity: style.opacity || 0.8,
                  dashArray: style.dashArray || '15, 10',
                  interactive: true,
                })
                
                // Bind popup to the outline only
                outlineLayer.bindPopup(popupContent)
                outlineLayer.addTo(map.current!)
                layersRef.current.push(outlineLayer)
                
                // Make the original polygon fill non-interactive (but keep it visible)
                ;(layer as any).options.interactive = false
                ;(layer as any).setStyle({ interactive: false })
              } else {
                // Fallback: bind popup normally
                layer.bindPopup(popupContent)
              }
            } 
            // For roads, trails, and lifts (LineString/MultiLineString), create a wider invisible interaction layer
            else if ((props.type === 'road' || props.type === 'trail' || props.type === 'lift') && 
                     (feature.geometry.type === 'LineString' || feature.geometry.type === 'MultiLineString')) {
              // Get coordinates for the line
              let lineCoords: number[][][] = []
              if (feature.geometry.type === 'LineString') {
                lineCoords = [feature.geometry.coordinates]
              } else {
                lineCoords = feature.geometry.coordinates
              }
              
              // Create an invisible wider interaction layer for each line segment
              lineCoords.forEach((coords) => {
                // Convert GeoJSON [lng, lat] to Leaflet [lat, lng]
                const latLngs = coords.map((coord: number[]) => [coord[1], coord[0]]) as [number, number][]
                
                // Create an invisible wider line for easier clicking (15px wide)
                const interactionLayer = L.polyline(latLngs, {
                  color: 'transparent',
                  weight: 15, // Much wider for easier clicking
                  opacity: 0,
                  fillOpacity: 0,
                  interactive: true,
                  className: 'leaflet-interactive-line', // Optional: for styling if needed
                })
                
                // Bind popup to the interaction layer
                interactionLayer.bindPopup(popupContent)
                interactionLayer.addTo(map.current!)
                layersRef.current.push(interactionLayer)
              })
              
              // Make the original visible line non-interactive (it's just for display)
              ;(layer as any).options.interactive = false
              ;(layer as any).setStyle({ interactive: false })
            } 
            else {
              // For other features (lifts, areas, etc.), bind popup normally
              layer.bindPopup(popupContent)
            }
            
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
      } catch {
        // Skip features that fail to add
      }
    })
  }

  // If 3D mode is enabled and scene URL is provided, render Three.js 3D view
  if (viewMode === '3d' && scene3DUrl) {
    return (
      <div className="relative w-full h-full">
        <MapView3D
          resortSlug={resortSlug}
          signs={signs}
          discoveredSignIds={discoveredSignIds}
          skiFeatures={skiFeatures}
          resortName={resortName}
          onSpeedUpdate={onSpeedUpdate}
          sceneUrl={scene3DUrl}
          center={scene3DCenter}
          additionalGeoJSONPaths={additionalGeoJSONPaths}
        />
        
        {/* Toggle Button - 3D to 2D */}
        <button
          onClick={() => setViewMode('2d')}
          className="fixed top-4 right-4 z-[1002] bg-white rounded-full p-3 shadow-lg hover:shadow-xl transition-all hover:scale-105 touch-manipulation text-gray-700"
          aria-label="Switch to 2D map"
          title="Switch to 2D map (shows all features)"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
          </svg>
        </button>
        
        {/* Info banner */}
        <div className="fixed top-16 left-1/2 transform -translate-x-1/2 z-[1002] bg-blue-50 border border-blue-200 rounded-lg px-4 py-2 shadow-lg pointer-events-none">
          <p className="text-xs text-blue-800 text-center">
            <strong>3D Terrain View:</strong> Shows your QGIS 3D terrain. Switch to 2D map to see all features (signs, trails, lifts).
          </p>
        </div>
      </div>
    )
  }


  return (
    <div className="relative w-full h-full">
      {/* Fullscreen Map */}
      <div ref={mapContainer} className="w-full h-full" />
      
      {/* 3D Toggle Button */}
      {scene3DUrl && (
        <button
          onClick={() => setViewMode('3d')}
          className="fixed top-4 right-4 z-[1002] bg-white rounded-full p-3 shadow-lg hover:shadow-xl transition-all hover:scale-105 touch-manipulation text-gray-700"
          aria-label="Switch to 3D map"
          title="Switch to 3D map - Interactive 3D with terrain and features"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
          </svg>
        </button>
      )}
      
      {/* Layer Switcher Button */}
      <div className={`fixed ${scene3DUrl ? 'top-16' : 'top-4'} right-4 z-[1001]`}>
        <button
          onClick={() => setShowLayerMenu(!showLayerMenu)}
          className="bg-white rounded-full p-3 shadow-lg hover:shadow-xl transition-all hover:scale-105 touch-manipulation text-gray-700"
          aria-label="Change map style"
          title="Change map style"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 5a1 1 0 011-1h4a1 1 0 011 1v7a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM14 5a1 1 0 011-1h4a1 1 0 011 1v7a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zM4 16a1 1 0 011-1h4a1 1 0 011 1v3a1 1 0 01-1 1H5a1 1 0 01-1-1v-3zM14 16a1 1 0 011-1h4a1 1 0 011 1v3a1 1 0 01-1 1h-4a1 1 0 01-1-1v-3z" />
          </svg>
        </button>
        
        {/* Layer Menu Dropdown */}
        {showLayerMenu && (
          <>
            {/* Backdrop to close menu on click outside */}
            <div 
              className="fixed inset-0 z-[1000]" 
              onClick={() => setShowLayerMenu(false)}
            />
            {/* Menu */}
            <div className="absolute top-full right-0 mt-2 bg-white rounded-lg shadow-xl overflow-hidden min-w-[160px] z-[1002]">
              <button
                onClick={() => switchBaseLayer('snowy')}
                className={`w-full text-left px-4 py-3 hover:bg-gray-50 transition-colors flex items-center justify-between ${
                  activeBaseLayer === 'snowy' ? 'bg-blue-50 text-blue-600' : 'text-gray-700'
                }`}
              >
                <span className="font-medium">Snowy Map</span>
                {activeBaseLayer === 'snowy' && (
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                )}
              </button>
              <button
                onClick={() => switchBaseLayer('standard')}
                className={`w-full text-left px-4 py-3 hover:bg-gray-50 transition-colors flex items-center justify-between border-t border-gray-100 ${
                  activeBaseLayer === 'standard' ? 'bg-blue-50 text-blue-600' : 'text-gray-700'
                }`}
              >
                <span className="font-medium">Standard Map</span>
                {activeBaseLayer === 'standard' && (
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                )}
              </button>
              <button
                onClick={() => switchBaseLayer('terrain')}
                className={`w-full text-left px-4 py-3 hover:bg-gray-50 transition-colors flex items-center justify-between border-t border-gray-100 ${
                  activeBaseLayer === 'terrain' ? 'bg-blue-50 text-blue-600' : 'text-gray-700'
                }`}
              >
                <span className="font-medium">Terrain Map</span>
                {activeBaseLayer === 'terrain' && (
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                )}
              </button>
              <button
                onClick={() => switchBaseLayer('satellite')}
                className={`w-full text-left px-4 py-3 hover:bg-gray-50 transition-colors flex items-center justify-between border-t border-gray-100 ${
                  activeBaseLayer === 'satellite' ? 'bg-blue-50 text-blue-600' : 'text-gray-700'
                }`}
              >
                <span className="font-medium">🛰️ Satellite</span>
                {activeBaseLayer === 'satellite' && (
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                )}
              </button>
              
              {/* Hillshade Overlay Toggle */}
              <div className="border-t border-gray-200 pt-2 mt-2">
                <div className="px-4 py-1 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  Terrain Overlay
                </div>
                <button
                  onClick={toggleHillshade}
                  className={`w-full text-left px-4 py-3 hover:bg-gray-50 transition-colors flex items-center justify-between ${
                    showHillshade ? 'bg-green-50 text-green-700' : 'text-gray-700'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
                    </svg>
                    <span className="font-medium">Hillshade</span>
                  </div>
                  <div className={`w-10 h-5 rounded-full transition-colors ${showHillshade ? 'bg-green-500' : 'bg-gray-300'}`}>
                    <div className={`w-4 h-4 bg-white rounded-full shadow transform transition-transform mt-0.5 ${showHillshade ? 'translate-x-5 ml-0.5' : 'translate-x-0.5'}`} />
                  </div>
                </button>
                
                {/* Hillshade Type Selector - only show when hillshade is enabled */}
                {showHillshade && (
                  <div className="px-4 py-2 bg-gray-50 border-t border-gray-100">
                    <div className="text-xs text-gray-500 mb-2">Terrain Style:</div>
                    <div className="grid grid-cols-2 gap-1.5">
                      <button
                        onClick={() => switchHillshadeType('esri')}
                        className={`px-2 py-1.5 text-xs font-medium rounded transition-colors ${
                          hillshadeType === 'esri' 
                            ? 'bg-green-600 text-white' 
                            : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-100'
                        }`}
                        title="Standard ESRI hillshade - varies by region"
                      >
                        ESRI
                      </button>
                      <button
                        onClick={() => switchHillshadeType('esri-dark')}
                        className={`px-2 py-1.5 text-xs font-medium rounded transition-colors ${
                          hillshadeType === 'esri-dark' 
                            ? 'bg-green-600 text-white' 
                            : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-100'
                        }`}
                        title="Darker ESRI hillshade - better contrast"
                      >
                        ESRI Dark
                      </button>
                      <button
                        onClick={() => switchHillshadeType('esri-terrain3d')}
                        className={`px-2 py-1.5 text-xs font-medium rounded transition-colors ${
                          hillshadeType === 'esri-terrain3d' 
                            ? 'bg-green-600 text-white' 
                            : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-100'
                        }`}
                        title="Dynamic terrain from elevation data - high resolution"
                      >
                        Terrain3D ⭐
                      </button>
                      <button
                        onClick={() => switchHillshadeType('esri-shaded')}
                        className={`px-2 py-1.5 text-xs font-medium rounded transition-colors ${
                          hillshadeType === 'esri-shaded' 
                            ? 'bg-green-600 text-white' 
                            : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-100'
                        }`}
                        title="Colored shaded relief - shows elevation"
                      >
                        Shaded
                      </button>
                      <button
                        onClick={() => switchHillshadeType('stadia')}
                        className={`col-span-2 px-2 py-1.5 text-xs font-medium rounded transition-colors ${
                          hillshadeType === 'stadia' 
                            ? 'bg-green-600 text-white' 
                            : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-100'
                        }`}
                        title="Stadia terrain - consistent quality"
                      >
                        Stadia (Consistent)
                      </button>
                    </div>
                    <div className="text-xs text-gray-400 mt-2">
                      {hillshadeType === 'esri' && '☀️ Standard hillshade - varies by region'}
                      {hillshadeType === 'esri-dark' && '🌑 Darker hillshade - better visibility'}
                      {hillshadeType === 'esri-terrain3d' && '🏔️ Dynamic elevation data - best quality!'}
                      {hillshadeType === 'esri-shaded' && '🎨 Colored relief - shows elevation bands'}
                      {hillshadeType === 'stadia' && '🗺️ Artistic terrain - consistent everywhere'}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>

      {/* Location Tracking Button */}
      <button
        onClick={toggleLocationTracking}
        className={`fixed ${scene3DUrl ? 'top-28' : 'top-16'} right-4 z-[1001] rounded-full p-3 shadow-lg hover:shadow-xl transition-all hover:scale-105 touch-manipulation ${
          isTrackingLocation 
            ? 'bg-blue-500 text-white' 
            : 'bg-white text-gray-700 hover:bg-gray-50'
        }`}
        aria-label={isTrackingLocation ? 'Stop tracking location' : 'Start tracking location'}
        title={isTrackingLocation ? 'Stop tracking location' : 'Show my location'}
      >
        {isTrackingLocation ? (
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 10a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" />
          </svg>
        ) : (
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        )}
      </button>

      {/* Speed Display Widget */}
      {isTrackingLocation && (
        <div className={`fixed ${scene3DUrl ? 'top-40' : 'top-28'} right-4 z-[1001] bg-white rounded-lg shadow-lg px-4 py-3 min-w-[120px]`}>
          <div className="flex items-center gap-2">
            <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            <div className="flex flex-col">
              <div className="text-xs text-gray-500 font-medium">Speed</div>
              <div className="text-lg font-bold text-gray-900">
                {userSpeed !== null ? (
                  <>
                    {Math.round(userSpeed)}
                    <span className="text-xs font-normal text-gray-500 ml-1">km/h</span>
                  </>
                ) : (
                  <span className="text-sm font-normal text-gray-400">--</span>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Location Error Message */}
      {locationError && (
        <div className={`fixed right-4 z-[1002] bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded-lg shadow-lg max-w-xs ${
          isTrackingLocation ? (scene3DUrl ? 'top-52' : 'top-40') : (scene3DUrl ? 'top-40' : 'top-28')
        }`}>
          <div className="flex items-start gap-2">
            <svg className="w-5 h-5 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div className="flex-1">
              <p className="text-sm font-medium">{locationError}</p>
            </div>
            <button
              onClick={() => setLocationError(null)}
              className="text-red-600 hover:text-red-800"
              aria-label="Dismiss error"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      )}
      
      {/* Legend Bubble at Bottom of Map - Hidden, we have our own UI */}
      <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 bg-white rounded-lg shadow-xl p-4 z-[999] max-w-md hidden">
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
