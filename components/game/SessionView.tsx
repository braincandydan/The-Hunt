'use client'

import { useState, useEffect, useRef, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import booleanPointInPolygon from '@turf/boolean-point-in-polygon'
import { point, polygon } from '@turf/helpers'
import { haversineDistance } from '@/lib/utils/run-tracking'

interface SessionViewProps {
  sessionId: string
  sessionData: {
    session: any
    completions: any[]
    descentSessions: any[]
    completionsByDescentSession: Record<string, any[]>
  }
  skiFeatures: Array<{
    id: string
    name: string
    type: 'trail' | 'lift' | 'boundary' | 'area' | 'road'
    difficulty?: string
    geometry: any
  }>
  map: any // Leaflet map instance
}

function DifficultyBadge({ difficulty }: { difficulty?: string }) {
  const colors: Record<string, string> = {
    'green': 'bg-green-500',
    'blue': 'bg-blue-500',
    'black': 'bg-gray-900',
    'double-black': 'bg-gray-900',
    'terrain-park': 'bg-orange-500'
  }
  
  const icons: Record<string, string> = {
    'green': '●',
    'blue': '■',
    'black': '◆',
    'double-black': '◆◆',
    'terrain-park': '🎿'
  }
  
  return (
    <span className={`inline-flex items-center justify-center w-4 h-4 rounded-full text-xs text-white font-bold ${colors[difficulty || ''] || 'bg-gray-400'}`}>
      {icons[difficulty || ''] || '○'}
    </span>
  )
}

function formatTime(dateStr: string): string {
  const date = new Date(dateStr)
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${mins}:${String(secs).padStart(2, '0')}`
}

export default function SessionView({ sessionId, sessionData, skiFeatures, map }: SessionViewProps) {
  const router = useRouter()
  const supabase = createClient()
  const [selectedDescent, setSelectedDescent] = useState<string | null>(null)
  const [currentDescentIndex, setCurrentDescentIndex] = useState<number>(0)
  const [routeData, setRouteData] = useState<{ type: 'LineString', coordinates: number[][] } | null>(null)
  const routeLayersRef = useRef<any[]>([])
  const completionLayersRef = useRef<any[]>([])
  const highlightedDescentLayersRef = useRef<any[]>([]) // Track all highlight layers individually
  const selectedDescentRef = useRef<string | null>(null)
  const routeSegmentsWithTimestampsRef = useRef<Array<{ coords: number[][], timestamps: string[] }>>([]) // Store route segments with timestamps
  
  // Timeline scrubber state
  const [isScrubbing, setIsScrubbing] = useState(false)
  const [scrubPosition, setScrubPosition] = useState<number>(0) // 0-1, 0 = start of session, 1 = end of session
  const [locationHistory, setLocationHistory] = useState<Array<{ latitude: number; longitude: number; recorded_at: string }>>([])
  const [sessionStartTime, setSessionStartTime] = useState<number | null>(null)
  const [sessionEndTime, setSessionEndTime] = useState<number | null>(null)
  const [timelineStartTime, setTimelineStartTime] = useState<number | null>(null) // Current timeline range start
  const [timelineEndTime, setTimelineEndTime] = useState<number | null>(null) // Current timeline range end
  const [routeSegmentsLoaded, setRouteSegmentsLoaded] = useState(false) // Track when route segments are loaded
  const scrubberMarkerRef = useRef<any>(null)
  const visibleDescentLayersRef = useRef<any[]>([]) // Descents visible at current scrub position
  const lastRenderedDescentIndexRef = useRef<number | null>(null) // Track last rendered descent to avoid unnecessary redraws
  
  // Swipe gesture handling
  const touchStartX = useRef<number | null>(null)
  const touchStartY = useRef<number | null>(null)
  const isDragging = useRef<boolean>(false)
  
  // Keep ref in sync with state
  useEffect(() => {
    selectedDescentRef.current = selectedDescent
  }, [selectedDescent])
  
  // Sync currentDescentIndex with selectedDescent
  useEffect(() => {
    if (selectedDescent) {
      const index = sessionData.descentSessions.findIndex(d => d.id === selectedDescent)
      if (index !== -1) {
        setCurrentDescentIndex(index)
      }
    }
  }, [selectedDescent, sessionData.descentSessions])
  
  // Update selectedDescent when currentDescentIndex changes - REMOVED
  // This was causing the timeline to focus in when scrolling through it
  // selectedDescent is now only set when the user explicitly clicks on a descent
  
  // Calculate total descent time (sum of all descent durations)
  const totalDescentTime = sessionData.descentSessions.reduce((total, descent) => {
    const start = new Date(descent.started_at).getTime()
    const end = descent.ended_at ? new Date(descent.ended_at).getTime() : (sessionEndTime || Date.now())
    return total + (end - start)
  }, 0)
  
  // Update timeline range when descent is selected
  useEffect(() => {
    if (selectedDescent && sessionStartTime !== null && sessionEndTime !== null) {
      const descent = sessionData.descentSessions.find(d => d.id === selectedDescent)
      if (descent) {
        const descentStart = new Date(descent.started_at).getTime()
        const descentEnd = descent.ended_at ? new Date(descent.ended_at).getTime() : sessionEndTime
        setTimelineStartTime(descentStart)
        setTimelineEndTime(descentEnd)
        // Reset scrub position to start of descent
        setScrubPosition(0)
      }
    } else {
      // When no descent selected, timeline is stretched evenly across all descents
      // Just need a valid time range (doesn't matter what it is since we map by descent index)
      if (sessionData.descentSessions.length > 0) {
        const firstDescent = sessionData.descentSessions[0]
        const lastDescent = sessionData.descentSessions[sessionData.descentSessions.length - 1]
        const firstTime = new Date(firstDescent.started_at).getTime()
        const lastTime = lastDescent.ended_at ? new Date(lastDescent.ended_at).getTime() : (sessionEndTime || Date.now())
        setTimelineStartTime(firstTime)
        setTimelineEndTime(lastTime)
        setScrubPosition(0)
      } else if (sessionStartTime !== null && sessionEndTime !== null) {
        // Fallback to session times
        setTimelineStartTime(sessionStartTime)
        setTimelineEndTime(sessionEndTime)
        setScrubPosition(0)
      }
    }
  }, [selectedDescent, sessionData.descentSessions, sessionStartTime, sessionEndTime, totalDescentTime, routeSegmentsLoaded, locationHistory.length])
  
  // Swipe handlers
  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX
    touchStartY.current = e.touches[0].clientY
    isDragging.current = false
  }
  
  const handleTouchMove = (e: React.TouchEvent) => {
    if (touchStartX.current === null || touchStartY.current === null) return
    
    const deltaX = Math.abs(e.touches[0].clientX - touchStartX.current)
    const deltaY = Math.abs(e.touches[0].clientY - touchStartY.current)
    
    // Only consider it dragging if horizontal movement is greater than vertical
    if (deltaX > deltaY && deltaX > 10) {
      isDragging.current = true
    }
  }
  
  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current === null || !isDragging.current) {
      touchStartX.current = null
      touchStartY.current = null
      return
    }
    
    const touchEndX = e.changedTouches[0].clientX
    const deltaX = touchEndX - touchStartX.current
    const swipeThreshold = 50
    
    if (Math.abs(deltaX) > swipeThreshold) {
      if (deltaX > 0) {
        // Swipe right - go to previous descent
        setCurrentDescentIndex(prev => Math.max(0, prev - 1))
      } else {
        // Swipe left - go to next descent
        setCurrentDescentIndex(prev => Math.min(sessionData.descentSessions.length - 1, prev + 1))
      }
    }
    
    touchStartX.current = null
    touchStartY.current = null
    isDragging.current = false
  }
  
  // Get resort boundary
  const resortBoundary = skiFeatures.find(f => f.type === 'boundary') || null
  
  // Helper function to check if a point is within resort boundary
  const isPointInResortBoundary = (lat: number, lng: number, boundary: typeof resortBoundary): boolean => {
    if (!boundary || !boundary.geometry) return true
    
    try {
      const geometry = boundary.geometry
      
      if (geometry.type === 'Polygon' && geometry.coordinates) {
        const poly = polygon(geometry.coordinates)
        const pt = point([lng, lat])
        return booleanPointInPolygon(pt, poly)
      }
      
      if (geometry.type === 'MultiPolygon' && geometry.coordinates) {
        for (const polygonCoords of geometry.coordinates) {
          const poly = polygon(polygonCoords)
          const pt = point([lng, lat])
          if (booleanPointInPolygon(pt, poly)) {
            return true
          }
        }
        return false
      }
      
      return true
    } catch (error) {
      console.warn('Error checking point in boundary:', error)
      return true
    }
  }
  
  // Fetch location history for timeline
  useEffect(() => {
    const fetchLocationHistory = async () => {
      try {
        const { data: locations, error } = await supabase
          .from('location_history')
          .select('latitude, longitude, recorded_at')
          .eq('session_id', sessionId)
          .order('recorded_at', { ascending: true })
          .limit(100000) // Ensure we get all location points (GPS tracking can generate many points)
        
        if (error || !locations || locations.length < 2) {
          return
        }
        
        setLocationHistory(locations)
        
        // Calculate session start and end times
        const startTime = new Date(locations[0].recorded_at).getTime()
        const endTime = new Date(locations[locations.length - 1].recorded_at).getTime()
        setSessionStartTime(startTime)
        setSessionEndTime(endTime)
        // Initialize timeline to show full session
        setTimelineStartTime(startTime)
        setTimelineEndTime(endTime)
      } catch (err) {
        console.warn('Error fetching location history:', err)
      }
    }
    
    fetchLocationHistory()
  }, [sessionId, supabase])
  
  // Fetch and draw route
  useEffect(() => {
    if (!map) return
    
    const fetchAndDrawRoute = async () => {
      try {
        const { data: locations, error } = await supabase
          .from('location_history')
          .select('latitude, longitude, altitude_meters, speed_kmh, recorded_at')
          .eq('session_id', sessionId)
          .order('recorded_at', { ascending: true })
        
        if (error || !locations || locations.length < 2) {
          setRouteData(null)
          return
        }
        
        // Filter locations to only include those within resort boundary
        const filteredLocations = locations.filter(l => 
          isPointInResortBoundary(l.latitude, l.longitude, resortBoundary)
        )
        
        const locationsToUse = filteredLocations.length >= 2 
          ? filteredLocations 
          : (!resortBoundary ? locations : [])
        
        if (locationsToUse.length >= 2) {
          const route: { type: 'LineString', coordinates: number[][] } = {
            type: 'LineString' as const,
            coordinates: locationsToUse.map(l => [l.longitude, l.latitude])
          }
          setRouteData(route)
          
          // Draw route on map
          const L = (window as any).L
          if (!L) return
          
          // Ensure completionPane exists (same as in the completions effect)
          if (!map.getPane('completionPane')) {
            const completionPane = map.createPane('completionPane')
            completionPane.style.zIndex = '2000'
          }
          
          // Clear previous route layers
          routeLayersRef.current.forEach(layer => map.removeLayer(layer))
          routeLayersRef.current = []
          
          const MAX_TIME_GAP_MS = 5 * 60 * 1000
          const MAX_DISTANCE_METERS = 1000
          
          const segments: number[][][] = []
          const segmentsWithTimestamps: Array<{ coords: number[][], timestamps: string[] }> = []
          let currentSegment: number[][] = []
          let currentTimestamps: string[] = []
          
          for (let i = 0; i < locationsToUse.length; i++) {
            const loc = locationsToUse[i]
            const coord = [loc.longitude, loc.latitude] as number[]
            
            if (i === 0) {
              currentSegment.push(coord)
              currentTimestamps.push(loc.recorded_at)
            } else {
              const prevLoc = locationsToUse[i - 1]
              const timeDiff = new Date(loc.recorded_at).getTime() - new Date(prevLoc.recorded_at).getTime()
              const distance = haversineDistance(
                prevLoc.latitude,
                prevLoc.longitude,
                loc.latitude,
                loc.longitude
              )
              
              if (timeDiff > MAX_TIME_GAP_MS || distance > MAX_DISTANCE_METERS) {
                if (currentSegment.length >= 2) {
                  segments.push(currentSegment)
                  segmentsWithTimestamps.push({ coords: currentSegment, timestamps: currentTimestamps })
                }
                currentSegment = [coord]
                currentTimestamps = [loc.recorded_at]
              } else {
                currentSegment.push(coord)
                currentTimestamps.push(loc.recorded_at)
              }
            }
          }
          
          if (currentSegment.length >= 2) {
            segments.push(currentSegment)
            segmentsWithTimestamps.push({ coords: currentSegment, timestamps: currentTimestamps })
          }
          
          // Store segments with timestamps for highlighting
          routeSegmentsWithTimestampsRef.current = segmentsWithTimestamps
          
          // #region agent log
          fetch('http://127.0.0.1:7243/ingest/a0dd1b5e-6580-44ae-9b6f-c3dccc8fc69d',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'SessionView.tsx:354',message:'BACKGROUND ROUTE DATA',data:{totalSegments:segments.length,segmentsWithTimestampsCount:segmentsWithTimestamps.length,segmentLengths:segments.map(s=>s.length),segmentsWithTimestampsLengths:segmentsWithTimestamps.map(s=>s.coords.length)},timestamp:Date.now(),sessionId:'debug-session',runId:'run2',hypothesisId:'DATA_SOURCE'})}).catch(()=>{});
          // #endregion
          
          // Trigger purple line drawing now that segments are loaded
          setRouteSegmentsLoaded(true)
          
          // Draw GPS route as orange dashed lines - add to completionPane (same high z-index)
          const routeColor = '#f97316'
          for (const segment of segments) {
            const segmentCoords = segment.map(c => [c[1], c[0]] as [number, number])
            
            // Draw outline first for contrast
            const routeOutline = L.polyline(segmentCoords, {
              color: '#000000', // Black outline
              weight: 5,
              opacity: 0.4,
              smoothFactor: 1,
              dashArray: '5, 5',
              pane: 'completionPane'
            }).addTo(map)
            
            // Draw main dashed line on top
            const polyline = L.polyline(segmentCoords, {
              color: routeColor,
              weight: 3,
              opacity: 1,
              smoothFactor: 1,
              dashArray: '5, 5',
              pane: 'completionPane' // Add to completionPane with high z-index
            }).addTo(map)
            
            routeLayersRef.current.push(routeOutline)
            routeLayersRef.current.push(polyline)
          }
          
          // Force route layers to front
          setTimeout(() => {
            routeLayersRef.current.forEach(layer => {
              if (layer && typeof layer.bringToFront === 'function') {
                layer.bringToFront()
              }
            })
            
            // Fit bounds to show the GPS route
            if (segments.length > 0) {
              let routeBounds: [[number, number], [number, number]] | null = null
              for (const segment of segments) {
                for (const coord of segment) {
                  const lat = coord[1]
                  const lng = coord[0]
                  if (!routeBounds) {
                    routeBounds = [[lat, lng], [lat, lng]]
                  } else {
                    routeBounds[0][0] = Math.min(routeBounds[0][0], lat)
                    routeBounds[0][1] = Math.min(routeBounds[0][1], lng)
                    routeBounds[1][0] = Math.max(routeBounds[1][0], lat)
                    routeBounds[1][1] = Math.max(routeBounds[1][1], lng)
                  }
                }
              }
              if (routeBounds) {
                map.fitBounds(routeBounds, { padding: [50, 50] })
              }
            }
          }, 100)
        }
      } catch (err) {
        console.warn('Error fetching route:', err)
      }
    }
    
    fetchAndDrawRoute()
  }, [map, sessionId, supabase, resortBoundary])
  
  // Draw completions on map
  useEffect(() => {
    if (!map) return
    
    const L = (window as any).L
    if (!L) return
    
    // Clear previous completion layers
    completionLayersRef.current.forEach(layer => map.removeLayer(layer))
    completionLayersRef.current = []
    
    // Create or get a custom pane for completion lines with MUCH higher z-index
    // This ensures completion lines are always above trail lines, labels, and everything else
    // Leaflet default panes: mapPane(200), tilePane(200), shadowPane(500), overlayPane(400), markerPane(600), tooltipPane(650), popupPane(700)
    if (!map.getPane('completionPane')) {
      const completionPane = map.createPane('completionPane')
      // Set z-index MUCH higher than everything else to ensure completions are on top
      completionPane.style.zIndex = '2000'
    }
    const completionPane = map.getPane('completionPane')
    
    const difficultyColors: Record<string, string> = {
      'green': '#22c55e',
      'blue': '#3b82f6',
      'black': '#1f2937',
      'double-black': '#7c3aed',
      'terrain-park': '#f97316',
      'other': '#9ca3af'
    }
    
    // Store trail layers to keep them in background
    const trailLayers: any[] = []
    
    // Draw all trails as faded background - add to default overlayPane
    const trails = skiFeatures.filter(f => f.type === 'trail')
    for (const trail of trails) {
      if (!trail.geometry) continue
      
      let coordsToDraw: number[][][] = []
      
      if (trail.geometry.type === 'LineString') {
        coordsToDraw = [trail.geometry.coordinates]
      } else if (trail.geometry.type === 'MultiLineString') {
        coordsToDraw = trail.geometry.coordinates
      } else {
        continue
      }
      
      const difficulty = trail.difficulty || 'other'
      const color = difficultyColors[difficulty] || difficultyColors['other']
      
      for (const coords of coordsToDraw) {
        const leafletCoords = coords.map(c => [c[1], c[0]] as [number, number])
        const trailLine = L.polyline(leafletCoords, {
          color: color,
          weight: 2, // Slightly smaller stroke width
          opacity: 0.4, // 80% opacity
          lineCap: 'round',
          lineJoin: 'round',
          interactive: false,
          pane: 'overlayPane' // Explicitly add to overlayPane (lower z-index)
        }).addTo(map)
        trailLayers.push(trailLine)
      }
    }
    
    // Don't draw individual completion tracks - only show the GPS route as dashed line
    // The GPS route (drawn in the other effect) shows the actual descent path
    
    // Force all completion layers to the front after a brief delay
    // This ensures they're rendered on top even if other layers are added later
    setTimeout(() => {
      completionLayersRef.current.forEach(layer => {
        if (layer && typeof layer.bringToFront === 'function') {
          layer.bringToFront()
        }
      })
    }, 100)
    
    // Fit bounds to show GPS route (if available) or use routeData from the other effect
    // Bounds will be set by the route drawing effect
    
    return () => {
      routeLayersRef.current.forEach(layer => map.removeLayer(layer))
      completionLayersRef.current.forEach(layer => map.removeLayer(layer))
      highlightedDescentLayersRef.current.forEach(layer => {
        try {
          if (layer && map.hasLayer(layer)) {
            map.removeLayer(layer)
          }
        } catch (e) {
          // Ignore errors
        }
      })
      highlightedDescentLayersRef.current = []
    }
  }, [map, sessionData, skiFeatures])
  
  // Highlight selected descent on map - highlight the corresponding segment of the dashed GPS route
  useEffect(() => {
    // ALWAYS clear ALL previous highlights first - do this synchronously, IMMEDIATELY
    // This MUST happen before any async operations
    const clearAllHighlights = () => {
      if (map) {
        // Remove all tracked highlight layers
        highlightedDescentLayersRef.current.forEach(layer => {
          try {
            if (layer && map.hasLayer(layer)) {
              map.removeLayer(layer)
            }
          } catch (e) {
            // Ignore errors
          }
        })
        highlightedDescentLayersRef.current = []
      }
    }
    
    // Clear immediately when effect runs - this MUST happen first
    clearAllHighlights()
    
    // Only draw highlight if a descent is selected
    if (!map || !selectedDescent || !routeData) {
      return
    }
    
    const L = (window as any).L
    if (!L) return
    
    // Get the selected descent session
    const descent = sessionData.descentSessions.find(d => d.id === selectedDescent)
    if (!descent) return
    
    // Store the descent ID we're about to highlight
    const currentDescentId = selectedDescent
    
    // Fetch location history to match timestamps with descent start/end times
    const highlightDescent = async () => {
      // Check if selection changed while we were fetching
      if (selectedDescentRef.current !== currentDescentId) {
        return
      }
      
      // Clear any existing highlight before drawing new one
      clearAllHighlights()
      
      // Double-check selection hasn't changed
      if (selectedDescentRef.current !== currentDescentId) {
        return
      }
      
      try {
        // Use the route segments that were already drawn - filter by descent time window
        const descentStartTime = new Date(descent.started_at).getTime()
        const descentEndTime = descent.ended_at ? new Date(descent.ended_at).getTime() : Date.now()
        
        // Find segments that overlap with the descent time window
        const descentSegments: number[][][] = []
        
        for (const segmentData of routeSegmentsWithTimestampsRef.current) {
          // Check if any timestamp in this segment falls within the descent time window
          const hasOverlap = segmentData.timestamps.some(timestamp => {
            const time = new Date(timestamp).getTime()
            return time >= descentStartTime && time <= descentEndTime
          })
          
          if (hasOverlap) {
            // Convert from [lng, lat] to [lat, lng] for Leaflet
            const leafletCoords = segmentData.coords.map(coord => [coord[1], coord[0]] as [number, number])
            descentSegments.push(leafletCoords)
          }
        }
        
        if (descentSegments.length === 0) {
          return
        }
        
        // Final check - make sure this is still the selected descent
        if (selectedDescentRef.current !== currentDescentId) {
          return
        }
        
        // Draw highlight for each segment of the descent
        const highlightColor = '#ff6b00' // Brighter orange
        const highlightLayers: any[] = []
        
        for (const segment of descentSegments) {
          // Draw outline
          const highlightOutline = L.polyline(segment, {
            color: '#ffffff', // White outline for maximum contrast
            weight: 8,
            opacity: 0.6,
            lineCap: 'round',
            lineJoin: 'round',
            pane: 'completionPane'
          }).addTo(map)
          
          // Draw main highlighted line
          const highlightLine = L.polyline(segment, {
            color: highlightColor,
            weight: 5,
            opacity: 1.0,
            lineCap: 'round',
            lineJoin: 'round',
            dashArray: '10, 5', // Dashed like the route but thicker
            pane: 'completionPane'
          }).addTo(map)
          
          // Bring to front
          highlightLine.bringToFront()
          highlightOutline.bringToFront()
          
          highlightLayers.push(highlightOutline, highlightLine)
        }
        
        // Final check before storing - if selection changed, remove what we just drew
        if (selectedDescentRef.current !== currentDescentId) {
          highlightLayers.forEach(layer => map.removeLayer(layer))
          return
        }
        
        // Store all layers
        highlightedDescentLayersRef.current = highlightLayers
        
        // Calculate bounds from all segments
        let descentBounds: [[number, number], [number, number]] | null = null
        for (const segment of descentSegments) {
          for (const coord of segment) {
            const lat = coord[0]
            const lng = coord[1]
            if (!descentBounds) {
              descentBounds = [[lat, lng], [lat, lng]]
            } else {
              descentBounds[0][0] = Math.min(descentBounds[0][0], lat)
              descentBounds[0][1] = Math.min(descentBounds[0][1], lng)
              descentBounds[1][0] = Math.max(descentBounds[1][0], lat)
              descentBounds[1][1] = Math.max(descentBounds[1][1], lng)
            }
          }
        }
          
        if (descentBounds) {
          // Account for bottom sheet taking up 20% of screen height
          // Top padding for session header, bottom padding for bottom sheet
          const topPadding = 60 // Session header height
          const bottomPadding = typeof window !== 'undefined' ? window.innerHeight * 0.2 + 20 : 200
          const padding = [topPadding, 50, bottomPadding, 50] // top, right, bottom, left
          
          // Use fitBounds with padding to ensure the entire descent fits in the available viewport
          setTimeout(() => {
            if (selectedDescentRef.current === currentDescentId && map) {
              map.fitBounds(descentBounds!, {
                padding: padding,
                maxZoom: 18,
                duration: 0.8
              })
            }
          }, 50)
        }
      } catch (err) {
        console.warn('Error highlighting descent:', err)
      }
    }
    
    highlightDescent()
    
    return () => {
      // Cleanup function - always remove ALL highlights when effect re-runs or unmounts
      if (map) {
        highlightedDescentLayersRef.current.forEach(layer => {
          try {
            if (layer && map.hasLayer(layer)) {
              map.removeLayer(layer)
            }
          } catch (e) {
            // Ignore errors
          }
        })
        highlightedDescentLayersRef.current = []
      }
    }
  }, [map, selectedDescent, sessionData, routeData, sessionId, supabase, resortBoundary])
  
  const handleClose = () => {
    // Get resort slug from current path
    const pathParts = window.location.pathname.split('/')
    const resortSlug = pathParts[1]
    router.push(`/${resortSlug}/game/map`)
  }
  
  // Get filtered location history (only points within descents when showing compressed timeline)
  const getDescentLocationHistory = useMemo(() => {
    if (!selectedDescent && sessionData.descentSessions.length > 0) {
      // Filter to only locations that fall within any descent time range
      const descentTimeRanges = sessionData.descentSessions.map(descent => ({
        start: new Date(descent.started_at).getTime(),
        end: descent.ended_at ? new Date(descent.ended_at).getTime() : (sessionEndTime || Date.now())
      }))
      
      return locationHistory.filter(loc => {
        const locTime = new Date(loc.recorded_at).getTime()
        return descentTimeRanges.some(range => locTime >= range.start && locTime <= range.end)
      })
    }
    return locationHistory
  }, [locationHistory, selectedDescent, sessionData.descentSessions, sessionEndTime])
  
  // Get location at scrub position (handles compressed descent timeline)
  const getLocationAtScrubPosition = (position: number) => {
    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/a0dd1b5e-6580-44ae-9b6f-c3dccc8fc69d',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'SessionView.tsx:740',message:'GET LOCATION AT SCRUB',data:{position,hasLocationHistory:locationHistory.length>0,timelineStartTime,timelineEndTime,selectedDescent,descentCount:sessionData.descentSessions.length},timestamp:Date.now(),sessionId:'debug-session',runId:'run5',hypothesisId:'MARKER'})}).catch(()=>{});
    // #endregion
    
    if (!locationHistory.length || timelineStartTime === null || timelineEndTime === null) {
      // #region agent log
      fetch('http://127.0.0.1:7243/ingest/a0dd1b5e-6580-44ae-9b6f-c3dccc8fc69d',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'SessionView.tsx:748',message:'GET LOCATION EARLY RETURN',data:{reason:!locationHistory.length?'no location history':timelineStartTime===null?'no start time':'no end time'},timestamp:Date.now(),sessionId:'debug-session',runId:'run5',hypothesisId:'MARKER'})}).catch(()=>{});
      // #endregion
      return null
    }
    
    let currentTime: number
    
    if (selectedDescent) {
      // When a descent is selected, use direct time mapping
      currentTime = timelineStartTime + (timelineEndTime - timelineStartTime) * position
    } else {
      // Timeline is stretched evenly across all descents
      // BUT we need to scrub through ROUTE SEGMENTS, not descent times
      const totalDescents = sessionData.descentSessions.length
      if (totalDescents === 0 || routeSegmentsWithTimestampsRef.current.length === 0) return null
      
      // Find which descent this position falls in
      const descentIndex = Math.min(Math.floor(position * totalDescents), totalDescents - 1)
      const positionInDescent = (position * totalDescents) - descentIndex
      
      // Now find which route segments belong to this descent
      const descent = sessionData.descentSessions[descentIndex]
      if (!descent) return null
      
      const descentStart = new Date(descent.started_at).getTime()
      const descentEnd = descent.ended_at ? new Date(descent.ended_at).getTime() : (sessionEndTime || Date.now())
      
      // Find route segments that overlap with this descent
      const relevantSegments: Array<{start: number, end: number, duration: number}> = []
      for (const segment of routeSegmentsWithTimestampsRef.current) {
        if (segment.timestamps.length === 0) continue
        
        const segmentStart = new Date(segment.timestamps[0]).getTime()
        const segmentEnd = new Date(segment.timestamps[segment.timestamps.length - 1]).getTime()
        
        // Check if this segment overlaps with the descent time range
        if (segmentEnd >= descentStart && segmentStart <= descentEnd) {
          relevantSegments.push({start: segmentStart, end: segmentEnd, duration: segmentEnd - segmentStart})
        }
      }
      
      // #region agent log
      fetch('http://127.0.0.1:7243/ingest/a0dd1b5e-6580-44ae-9b6f-c3dccc8fc69d',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'SessionView.tsx:774',message:'DESCENT SEGMENT MAPPING',data:{position,descentIndex,positionInDescent,descentStart,descentEnd,descentStartISO:new Date(descentStart).toISOString(),descentEndISO:new Date(descentEnd).toISOString(),relevantSegmentsCount:relevantSegments.length,relevantSegmentRanges:relevantSegments.map(s=>({startISO:new Date(s.start).toISOString(),endISO:new Date(s.end).toISOString()}))},timestamp:Date.now(),sessionId:'debug-session',runId:'run6',hypothesisId:'SEGMENT_MAPPING'})}).catch(()=>{});
      // #endregion
      
      if (relevantSegments.length === 0) {
        // Fallback to descent time if no segments found
        currentTime = descentStart + (descentEnd - descentStart) * positionInDescent
      } else {
        // Map position through the relevant route segments
        const totalSegmentTime = relevantSegments.reduce((sum, seg) => sum + seg.duration, 0)
        const targetTime = totalSegmentTime * positionInDescent
        
        let cumulativeTime = 0
        currentTime = relevantSegments[0].start // fallback
        
        for (const segment of relevantSegments) {
          if (cumulativeTime + segment.duration >= targetTime) {
            const posInSegment = (targetTime - cumulativeTime) / segment.duration
            currentTime = segment.start + segment.duration * posInSegment
            break
          }
          cumulativeTime += segment.duration
        }
      }
    }
    
    if (currentTime === undefined) {
      return null
    }
    
    // Use full location history to find the closest point
    const locationsToSearch = locationHistory
    
    if (locationsToSearch.length === 0) {
      return null
    }
    
    // Find the closest location to the current time
    let closestLocation = locationsToSearch[0]
    let minTimeDiff = Math.abs(new Date(locationsToSearch[0].recorded_at).getTime() - currentTime)
    
    for (const loc of locationsToSearch) {
      const timeDiff = Math.abs(new Date(loc.recorded_at).getTime() - currentTime)
      if (timeDiff < minTimeDiff) {
        minTimeDiff = timeDiff
        closestLocation = loc
      }
    }
    
    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/a0dd1b5e-6580-44ae-9b6f-c3dccc8fc69d',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'SessionView.tsx:786',message:'LOCATION FOUND',data:{position,descentIndex:selectedDescent?null:Math.floor(position*sessionData.descentSessions.length),currentTime,currentTimeISO:new Date(currentTime).toISOString(),closestLocationTime:closestLocation.recorded_at,closestLocationLat:closestLocation.latitude,closestLocationLng:closestLocation.longitude,minTimeDiff},timestamp:Date.now(),sessionId:'debug-session',runId:'run5',hypothesisId:'MARKER'})}).catch(()=>{});
    // #endregion
    
    return closestLocation
  }
  
  // Update which descent is shown in bottom panel based on scrub position
  useEffect(() => {
    if (!isScrubbing || scrubPosition === null || sessionData.descentSessions.length === 0) {
      return
    }
    
    if (timelineStartTime === null || timelineEndTime === null) return
    
    let currentTime: number
    
    if (selectedDescent) {
      // When a descent is selected, use direct time mapping
      currentTime = timelineStartTime + (timelineEndTime - timelineStartTime) * scrubPosition
    } else {
      // Timeline is stretched evenly across all descents
      // Find which descent this position falls in
      const totalDescents = sessionData.descentSessions.length
      const descentIndex = Math.min(Math.floor(scrubPosition * totalDescents), totalDescents - 1)
      const positionInDescent = (scrubPosition * totalDescents) - descentIndex
      
      const descent = sessionData.descentSessions[descentIndex]
      if (!descent) return
      
      const descentStart = new Date(descent.started_at).getTime()
      const descentEnd = descent.ended_at ? new Date(descent.ended_at).getTime() : sessionEndTime
      
      // Find route segments that overlap with this descent
      const relevantSegments: Array<{start: number, end: number, duration: number}> = []
      for (const segment of routeSegmentsWithTimestampsRef.current) {
        if (segment.timestamps.length === 0) continue
        
        const segmentStart = new Date(segment.timestamps[0]).getTime()
        const segmentEnd = new Date(segment.timestamps[segment.timestamps.length - 1]).getTime()
        
        // Check if this segment overlaps with the descent time range
        if (segmentEnd >= descentStart && segmentStart <= descentEnd) {
          relevantSegments.push({start: segmentStart, end: segmentEnd, duration: segmentEnd - segmentStart})
        }
      }
      
      if (relevantSegments.length === 0) {
        // Fallback to descent time if no segments found
        currentTime = descentStart + (descentEnd - descentStart) * positionInDescent
      } else {
        // Map position through the relevant route segments
        const totalSegmentTime = relevantSegments.reduce((sum, seg) => sum + seg.duration, 0)
        const targetTime = totalSegmentTime * positionInDescent
        
        let cumulativeTime = 0
        currentTime = relevantSegments[0].start // fallback
        
        for (const segment of relevantSegments) {
          if (cumulativeTime + segment.duration >= targetTime) {
            const posInSegment = (targetTime - cumulativeTime) / segment.duration
            currentTime = segment.start + segment.duration * posInSegment
            break
          }
          cumulativeTime += segment.duration
        }
      }
    }
    
    // Find which descent contains this time
    for (let i = 0; i < sessionData.descentSessions.length; i++) {
      const descent = sessionData.descentSessions[i]
      const descentStart = new Date(descent.started_at).getTime()
      const descentEnd = descent.ended_at ? new Date(descent.ended_at).getTime() : (sessionEndTime || Date.now())
      
      if (currentTime >= descentStart && currentTime <= descentEnd) {
        // Update to show this descent at bottom (but don't focus timeline - only update index)
        if (currentDescentIndex !== i) {
          setCurrentDescentIndex(i)
          // Don't set selectedDescent here - that causes the timeline to focus in
          // selectedDescent should only be set when user explicitly clicks on a descent
        }
        break
      }
    }
  }, [isScrubbing, scrubPosition, sessionData.descentSessions, selectedDescent, timelineStartTime, timelineEndTime, totalDescentTime, sessionEndTime, currentDescentIndex])
  
  // Update map based on scrub position (only when scrubbing)
  useEffect(() => {
    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/a0dd1b5e-6580-44ae-9b6f-c3dccc8fc69d',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'SessionView.tsx:830',message:'MARKER UPDATE EFFECT',data:{hasMap:!!map,isScrubbing,scrubPosition,locationHistoryCount:locationHistory.length,timelineStartTime,timelineEndTime},timestamp:Date.now(),sessionId:'debug-session',runId:'run3',hypothesisId:'MARKER'})}).catch(()=>{});
    // #endregion
    
    if (!map || !isScrubbing || scrubPosition === null || locationHistory.length === 0 || timelineStartTime === null || timelineEndTime === null) {
      // Clean up when not scrubbing
      if (!isScrubbing && scrubberMarkerRef.current) {
        map?.removeLayer(scrubberMarkerRef.current)
        scrubberMarkerRef.current = null
      }
      // #region agent log
      fetch('http://127.0.0.1:7243/ingest/a0dd1b5e-6580-44ae-9b6f-c3dccc8fc69d',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'SessionView.tsx:843',message:'MARKER UPDATE EARLY RETURN',data:{reason:!map?'no map':!isScrubbing?'not scrubbing':scrubPosition===null?'no scrub position':locationHistory.length===0?'no location history':timelineStartTime===null?'no start time':'no end time'},timestamp:Date.now(),sessionId:'debug-session',runId:'run3',hypothesisId:'MARKER'})}).catch(()=>{});
      // #endregion
      return
    }
    
    const location = getLocationAtScrubPosition(scrubPosition)
    if (!location) return
    
    const L = (window as any).L
    if (!L) return
    
    // Remove old marker
    if (scrubberMarkerRef.current) {
      map.removeLayer(scrubberMarkerRef.current)
    }
    
    // Create new marker at scrub position
    const icon = L.divIcon({
      className: 'scrubber-marker',
      html: '<div style="width: 20px; height: 20px; background-color: #3b82f6; border: 3px solid #ffffff; border-radius: 50%; box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.5), 0 0 15px rgba(59, 130, 246, 0.8);"></div>',
      iconSize: [20, 20],
      iconAnchor: [10, 10],
    })
    
    scrubberMarkerRef.current = L.marker([location.latitude, location.longitude], { icon })
      .addTo(map)
    
    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/a0dd1b5e-6580-44ae-9b6f-c3dccc8fc69d',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'SessionView.tsx:855',message:'MARKER PLACED',data:{lat:location.latitude,lng:location.longitude,scrubPosition},timestamp:Date.now(),sessionId:'debug-session',runId:'run3',hypothesisId:'MARKER'})}).catch(()=>{});
    // #endregion
    
    // Pan to location smoothly
    map.panTo([location.latitude, location.longitude], { duration: 0.3 })
  }, [map, isScrubbing, scrubPosition, locationHistory, timelineStartTime, timelineEndTime, sessionData.descentSessions])
  
  // Show the FULL route in purple when scrolling (don't filter by descent)
  // The descent shown at the bottom changes based on scrub position, but we show the full route
  useEffect(() => {
    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/a0dd1b5e-6580-44ae-9b6f-c3dccc8fc69d',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'SessionView.tsx:891',message:'PURPLE LINE EFFECT ENTRY',data:{hasMap:!!map,selectedDescent,routeSegmentsCount:routeSegmentsWithTimestampsRef.current.length,descentSessionsCount:sessionData.descentSessions.length,visibleDescentLayersCount:visibleDescentLayersRef.current.length,routeSegmentsLoaded},timestamp:Date.now(),sessionId:'debug-session',runId:'run2',hypothesisId:'PURPLE_DRAW'})}).catch(()=>{});
    // #endregion
    
    if (!map || selectedDescent || !routeSegmentsLoaded || routeSegmentsWithTimestampsRef.current.length === 0 || sessionData.descentSessions.length === 0) {
      // Clear visible descent layers when a descent is selected (it will use highlighted layers instead)
      if (selectedDescent) {
        visibleDescentLayersRef.current.forEach(layer => map?.removeLayer(layer))
        visibleDescentLayersRef.current = []
        lastRenderedDescentIndexRef.current = null
      }
      // #region agent log
      fetch('http://127.0.0.1:7243/ingest/a0dd1b5e-6580-44ae-9b6f-c3dccc8fc69d',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'SessionView.tsx:904',message:'PURPLE LINE EARLY RETURN',data:{reason:!map?'no map':selectedDescent?'has selectedDescent':!routeSegmentsLoaded?'route segments not loaded yet':routeSegmentsWithTimestampsRef.current.length===0?'no route segments':'no descent sessions'},timestamp:Date.now(),sessionId:'debug-session',runId:'run2',hypothesisId:'PURPLE_DRAW'})}).catch(()=>{});
      // #endregion
      return
    }
    
    // Only draw once - skip if already rendered
    if (visibleDescentLayersRef.current.length > 0) {
      // #region agent log
      fetch('http://127.0.0.1:7243/ingest/a0dd1b5e-6580-44ae-9b6f-c3dccc8fc69d',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'SessionView.tsx:912',message:'PURPLE LINE ALREADY RENDERED',data:{visibleLayersCount:visibleDescentLayersRef.current.length},timestamp:Date.now(),sessionId:'debug-session',runId:'run2',hypothesisId:'PURPLE_DRAW'})}).catch(()=>{});
      // #endregion
      return
    }
    
    const L = (window as any).L
    if (!L) return
    
    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/a0dd1b5e-6580-44ae-9b6f-c3dccc8fc69d',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'SessionView.tsx:923',message:'DRAWING PURPLE LINES',data:{totalSegments:routeSegmentsWithTimestampsRef.current.length,segmentSizes:routeSegmentsWithTimestampsRef.current.map(s=>({coordCount:s.coords.length,timestampCount:s.timestamps.length}))},timestamp:Date.now(),sessionId:'debug-session',runId:'run2',hypothesisId:'PURPLE_DRAW'})}).catch(()=>{});
    // #endregion
      
    // Draw ALL route segments in purple (same path as background route, just different color)
    // This allows the user to scrub through the entire path
    // The descent shown at the bottom changes based on scrub position
    let segmentIndex = 0
    for (const segmentData of routeSegmentsWithTimestampsRef.current) {
      const leafletCoords = segmentData.coords.map(coord => [coord[1], coord[0]] as [number, number])
      
      // #region agent log
      fetch('http://127.0.0.1:7243/ingest/a0dd1b5e-6580-44ae-9b6f-c3dccc8fc69d',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'SessionView.tsx:931',message:'DRAWING PURPLE SEGMENT',data:{segmentIndex,coordCount:leafletCoords.length,firstCoord:leafletCoords[0],lastCoord:leafletCoords[leafletCoords.length-1]},timestamp:Date.now(),sessionId:'debug-session',runId:'run2',hypothesisId:'PURPLE_DRAW'})}).catch(()=>{});
      // #endregion
      
      const descentLine = L.polyline(leafletCoords, {
        color: '#9333ea', // Purple color to distinguish from orange background route
        weight: 4, // Slightly thicker than background route to make it stand out
        opacity: 1,
        dashArray: '5, 5',
        smoothFactor: 1,
        pane: 'completionPane'
      }).addTo(map)
      descentLine.bringToFront()
      visibleDescentLayersRef.current.push(descentLine)
      segmentIndex++
    }
    
    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/a0dd1b5e-6580-44ae-9b6f-c3dccc8fc69d',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'SessionView.tsx:949',message:'PURPLE LINES DRAWN COMPLETE',data:{totalSegmentsDrawn:segmentIndex,visibleLayersCount:visibleDescentLayersRef.current.length},timestamp:Date.now(),sessionId:'debug-session',runId:'run2',hypothesisId:'PURPLE_DRAW'})}).catch(()=>{});
    // #endregion
    
    // Mark as rendered
    lastRenderedDescentIndexRef.current = 0
  }, [map, selectedDescent, sessionData.descentSessions, routeSegmentsLoaded])
  
  // Cleanup scrubber marker on unmount
  useEffect(() => {
    return () => {
      if (map && scrubberMarkerRef.current) {
        map.removeLayer(scrubberMarkerRef.current)
      }
      visibleDescentLayersRef.current.forEach(layer => {
        if (map) map.removeLayer(layer)
      })
    }
  }, [map])
  
  const isScrubbingRef = useRef(false)
  
  // Handle scrubber drag
  const handleScrubberMouseDown = (e: React.MouseEvent) => {
    e.preventDefault()
    isScrubbingRef.current = true
    setIsScrubbing(true)
    updateScrubPosition(e)
    
    // Add global mouse handlers
    const handleMouseMove = (e: MouseEvent) => {
      if (!isScrubbingRef.current) return
      const scrubberElement = document.querySelector('.timeline-scrubber') as HTMLElement
      if (!scrubberElement) return
      const rect = scrubberElement.getBoundingClientRect()
      const position = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height)) // Top = 0 (start), Bottom = 1 (end)
      setScrubPosition(position)
    }
    
    const handleMouseUp = () => {
      isScrubbingRef.current = false
      setIsScrubbing(false)
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
    
    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
  }
  
  const updateScrubPosition = (e: React.MouseEvent | React.TouchEvent) => {
    const scrubberElement = e.currentTarget as HTMLElement
    const rect = scrubberElement.getBoundingClientRect()
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY
    const position = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height)) // Top = 0 (start), Bottom = 1 (end)
    setScrubPosition(position)
  }
  
  const handleScrubberMove = (e: React.MouseEvent) => {
    if (!isScrubbingRef.current) return
    updateScrubPosition(e)
  }
  
  const handleScrubberMouseUp = () => {
    isScrubbingRef.current = false
    setIsScrubbing(false)
  }
  
  // Handle touch events for mobile
  const handleScrubberTouchStart = (e: React.TouchEvent) => {
    e.preventDefault()
    isScrubbingRef.current = true
    setIsScrubbing(true)
    updateScrubPosition(e)
  }
  
  const handleScrubberTouchMove = (e: React.TouchEvent) => {
    if (!isScrubbingRef.current) return
    e.preventDefault()
    updateScrubPosition(e)
  }
  
  const handleScrubberTouchEnd = () => {
    isScrubbingRef.current = false
    setIsScrubbing(false)
  }
  
  const currentDescent = sessionData.descentSessions[currentDescentIndex]
  const segments = currentDescent ? sessionData.completionsByDescentSession[currentDescent.id] || [] : []
  const duration = currentDescent && currentDescent.ended_at 
    ? Math.round((new Date(currentDescent.ended_at).getTime() - new Date(currentDescent.started_at).getTime()) / 1000)
    : null
  
  if (sessionData.descentSessions.length === 0) {
    return (
      <div className="fixed bottom-0 left-0 right-0 z-[1001] safe-area-bottom">
        <div className="bg-gradient-to-br from-gray-900/95 to-gray-800/95 backdrop-blur-xl rounded-t-3xl border-t border-white/10 shadow-2xl">
          <div className="p-8 text-center text-gray-400">
            <p>No descent sessions recorded</p>
          </div>
        </div>
      </div>
    )
  }
  
  return (
    <>
      {/* Timeline Scrubber on Right */}
      {locationHistory.length > 0 && timelineStartTime !== null && timelineEndTime !== null && sessionStartTime !== null && sessionEndTime !== null && (
        <div className="fixed right-4 top-20 bottom-[20vh] z-[1003] w-12">
          <div
            className="timeline-scrubber relative h-full bg-gray-900/80 backdrop-blur-xl rounded-2xl border border-white/10 shadow-xl cursor-grab active:cursor-grabbing select-none overflow-hidden"
            onMouseDown={handleScrubberMouseDown}
            onMouseMove={handleScrubberMove}
            onMouseUp={handleScrubberMouseUp}
            onMouseLeave={handleScrubberMouseUp}
            onTouchStart={handleScrubberTouchStart}
            onTouchMove={handleScrubberTouchMove}
            onTouchEnd={handleScrubberTouchEnd}
          >
            {/* Descent markers on timeline - stretched evenly to fill the entire timeline bar */}
            {!selectedDescent && sessionData.descentSessions.map((descent, idx) => {
              // Stretch all descents evenly across the timeline (each gets equal space)
              const totalDescents = sessionData.descentSessions.length
              const startPosition = idx / totalDescents
              const height = (1 / totalDescents) * 100
              const isFirst = idx === 0
              
              return (
                <div key={descent.id}>
                  {/* THICK WHITE SEPARATOR LINE between descents - VERY VISIBLE */}
                  {!isFirst && (
                    <div
                      className="absolute left-0 right-0 bg-white z-30"
                      style={{
                        top: `${startPosition * 100}%`,
                        height: '4px',
                        transform: 'translateY(-2px)',
                        boxShadow: '0 0 8px rgba(255, 255, 255, 1), 0 0 12px rgba(255, 255, 255, 0.8)'
                      }}
                    />
                  )}
                  
                  {/* Descent segment - CLEARLY BOUNDED */}
                  <div
                    className="absolute left-0 right-0 bg-orange-500 z-10"
                    style={{
                      top: `${startPosition * 100}%`,
                      height: `${Math.max(4, height)}%`,
                      opacity: 0.95,
                      // Thick white borders on all sides to clearly mark boundaries
                      borderTop: isFirst ? '4px solid #ffffff' : '0px',
                      borderBottom: idx === sessionData.descentSessions.length - 1 ? '4px solid #ffffff' : '0px',
                      borderLeft: '3px solid #ffffff',
                      borderRight: '3px solid #ffffff',
                      boxShadow: '0 0 6px rgba(0, 0, 0, 0.3), inset 0 0 4px rgba(0, 0, 0, 0.2)'
                    }}
                    title={`Descent ${idx + 1}`}
                  >
                    {/* Descent number label - TOP LEFT CORNER, ALWAYS VISIBLE */}
                    <div className="absolute top-0 left-0 px-1.5 py-0.5 bg-white text-orange-600 text-[10px] font-extrabold pointer-events-none shadow-lg border-2 border-orange-500 rounded-br">
                      {idx + 1}
                    </div>
                    
                    {/* Descent start indicator - LEFT SIDE */}
                    <div 
                      className="absolute left-0 top-0 bottom-0 w-1 bg-white/90"
                      style={{ zIndex: 15 }}
                    />
                    
                    {/* Descent end indicator - RIGHT SIDE */}
                    <div 
                      className="absolute right-0 top-0 bottom-0 w-1 bg-white/90"
                      style={{ zIndex: 15 }}
                    />
                  </div>
                </div>
              )
            })}
            
            {/* When a descent is selected, show only that descent */}
            {selectedDescent && (() => {
              const descent = sessionData.descentSessions.find(d => d.id === selectedDescent)
              if (!descent) return null
              
              const descentStart = new Date(descent.started_at).getTime()
              const descentEnd = descent.ended_at ? new Date(descent.ended_at).getTime() : (timelineEndTime || Date.now())
              
              return (
                <div
                  className="absolute left-0 right-0 bg-orange-400 rounded"
                  style={{
                    top: '0%',
                    height: '100%',
                    opacity: 1
                  }}
                  title={`Descent ${currentDescentIndex + 1}`}
                />
              )
            })()}
            
            {/* Scrubber handle */}
            <div
              className="absolute left-0 right-0 w-full bg-blue-500 rounded-full shadow-lg"
              style={{
                top: `${scrubPosition * 100}%`,
                transform: 'translateY(-50%)',
                height: '4px'
              }}
            >
              <div className="absolute -left-1 -right-1 top-1/2 -translate-y-1/2 h-6 w-6 bg-blue-500 rounded-full border-2 border-white shadow-lg" />
            </div>
            
            {/* Time label */}
            {isScrubbing && (
              <div
                className="absolute left-full ml-2 px-2 py-1 bg-gray-900/95 backdrop-blur-xl rounded text-xs text-white whitespace-nowrap"
                style={{
                  top: `${scrubPosition * 100}%`,
                  transform: 'translateY(-50%)'
                }}
              >
                {(() => {
                  if (timelineStartTime === null || timelineEndTime === null) return ''
                  const currentTime = timelineStartTime + (timelineEndTime - timelineStartTime) * scrubPosition
                  return new Date(currentTime).toLocaleTimeString('en-US', { 
                    hour: 'numeric', 
                    minute: '2-digit',
                    second: '2-digit',
                    hour12: true 
                  })
                })()}
              </div>
            )}
          </div>
        </div>
      )}
      
      {/* Session Info at Top */}
      <div className="fixed top-0 left-0 right-0 z-[1002] safe-area-top">
        <div className="bg-gradient-to-br from-gray-900/95 to-gray-800/95 backdrop-blur-xl border-b border-white/10 shadow-lg">
          <div className="px-4 py-3 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-white">Session</h3>
              <p className="text-xs text-gray-400">
                {new Date(sessionData.session.session_date).toLocaleDateString('en-US', { 
                  month: 'short', 
                  day: 'numeric', 
                  year: 'numeric' 
                })}
              </p>
            </div>
            <button
              onClick={handleClose}
              className="p-2 rounded-lg hover:bg-white/10 transition-colors"
            >
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      </div>
      
      {/* Bottom Sheet with Swipeable Descent Card - Fixed 20% height */}
      <div className="fixed bottom-0 left-0 right-0 z-[1001] safe-area-bottom" style={{ height: '20vh' }}>
        <div 
          className="bg-gradient-to-br from-gray-900/95 to-gray-800/95 backdrop-blur-xl rounded-t-3xl border-t border-white/10 shadow-2xl h-full flex flex-col overflow-hidden"
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          {/* Drag Handle */}
          <div className="flex justify-center pt-2 pb-1 flex-shrink-0">
            <div className="w-12 h-1 bg-white/30 rounded-full"></div>
          </div>
          
          {/* Swipeable Descent Card - Scrollable content */}
          <div className="flex-1 overflow-y-auto px-4 py-2">
            <div className="bg-white/5 rounded-xl p-3 border border-white/10">
              {/* Descent Header with Navigation */}
              <div className="flex items-center justify-between mb-3">
                <button
                  onClick={() => setCurrentDescentIndex(prev => Math.max(0, prev - 1))}
                  disabled={currentDescentIndex === 0}
                  className={`p-1.5 rounded-lg transition-colors ${
                    currentDescentIndex === 0 
                      ? 'opacity-30 cursor-not-allowed' 
                      : 'hover:bg-white/10 active:bg-white/20'
                  }`}
                >
                  <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                </button>
                
                <div className="flex-1"></div>
                
                <button
                  onClick={() => setCurrentDescentIndex(prev => Math.min(sessionData.descentSessions.length - 1, prev + 1))}
                  disabled={currentDescentIndex === sessionData.descentSessions.length - 1}
                  className={`p-1.5 rounded-lg transition-colors ${
                    currentDescentIndex === sessionData.descentSessions.length - 1 
                      ? 'opacity-30 cursor-not-allowed' 
                      : 'hover:bg-white/10 active:bg-white/20'
                  }`}
                >
                  <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              </div>
              
              {/* MAIN INFO - Descent Number/Time and Speeds */}
              {currentDescent && (
                <>
                  {/* Descent Info: Number/Time on left, Speeds in boxes on right */}
                  <div className="flex items-start justify-between gap-3 mb-3">
                    {/* Left: Descent Number with Time below */}
                    <div className="flex-shrink-0">
                      <div className="text-base font-semibold text-white mb-1">
                        Descent {currentDescentIndex + 1}
                      </div>
                      <div className="text-xs text-gray-400">
                        <div className="flex items-center gap-1">
                          <span>🕐</span>
                          <span>
                            {formatTime(currentDescent.started_at)}
                            {duration && ` • ${formatDuration(duration)}`}
                          </span>
                        </div>
                      </div>
                    </div>
                    
                    {/* Right: Speed boxes */}
                    <div className="flex gap-2 flex-shrink-0">
                      {/* Top Speed Box */}
                      {currentDescent.top_speed_kmh > 0 && (
                        <div className="bg-white/10 rounded-lg px-3 py-2 border border-white/20">
                          <div className="text-[10px] text-gray-400 mb-0.5">Top Speed</div>
                          <div className="text-sm font-semibold text-white">{currentDescent.top_speed_kmh.toFixed(0)} km/h</div>
                        </div>
                      )}
                      
                      {/* Avg Speed Box */}
                      {currentDescent.avg_speed_kmh > 0 && (
                        <div className="bg-white/10 rounded-lg px-3 py-2 border border-white/20">
                          <div className="text-[10px] text-gray-400 mb-0.5">Avg Speed</div>
                          <div className="text-sm font-semibold text-white">{currentDescent.avg_speed_kmh.toFixed(1)} km/h</div>
                        </div>
                      )}
                    </div>
                  </div>
                  
                  {/* Additional Stats Grid (Vertical, Distance) */}
                  {(currentDescent.total_vertical_meters > 0 || currentDescent.total_distance_meters > 0) && (
                    <div className="grid grid-cols-2 gap-2 mb-3">
                      {currentDescent.total_vertical_meters > 0 && (
                        <div className="bg-white/5 rounded-lg p-2 text-center">
                          <div className="text-[10px] text-gray-400 mb-0.5">Vertical</div>
                          <div className="text-sm font-semibold text-white">{currentDescent.total_vertical_meters.toFixed(0)} m</div>
                        </div>
                      )}
                      {currentDescent.total_distance_meters > 0 && (
                        <div className="bg-white/5 rounded-lg p-2 text-center">
                          <div className="text-[10px] text-gray-400 mb-0.5">Distance</div>
                          <div className="text-sm font-semibold text-white">{(currentDescent.total_distance_meters / 1000).toFixed(2)} km</div>
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
              
              {/* SEGMENTS LIST - ALWAYS LAST, AFTER ALL MAIN INFO */}
              {currentDescent && segments.length > 0 && (
                <div className="mt-3 pt-3 border-t border-white/10 space-y-1.5">
                  <div className="text-xs text-gray-400 mb-2">Segments:</div>
                  {segments.map((completion, i) => {
                    const feature = skiFeatures.find(f => f.id === completion.ski_feature_id)
                    const isOffTrail = completion.segment_type === 'off_trail'
                    return (
                      <div key={completion.id} className="flex items-center gap-1.5 text-[10px]">
                        <span className="text-gray-500 w-3">{i + 1}.</span>
                        {isOffTrail ? (
                          <span className="text-amber-400 text-xs">🌲</span>
                        ) : (
                          <DifficultyBadge difficulty={feature?.difficulty} />
                        )}
                        <span className="flex-1 text-white truncate text-[10px]">
                          {isOffTrail 
                            ? `Off-trail (from ${feature?.name || 'Unknown'})`
                            : (feature?.name || 'Unknown Run')
                          }
                        </span>
                        {completion.top_speed_kmh && (
                          <span className="text-gray-400 text-[10px]">
                            {completion.top_speed_kmh.toFixed(0)} km/h
                          </span>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
          
          {/* Page Indicators */}
          <div className="flex justify-center gap-1.5 pb-2 flex-shrink-0">
            {sessionData.descentSessions.map((_, idx) => (
              <button
                key={idx}
                onClick={() => {
                  // When user clicks on descent indicator, focus in on that descent
                  const descent = sessionData.descentSessions[idx]
                  if (descent) {
                    setSelectedDescent(descent.id)
                  }
                }}
                className={`h-1 rounded-full transition-all ${
                  idx === currentDescentIndex 
                    ? 'bg-white w-6' 
                    : 'bg-white/30 w-1 hover:bg-white/50'
                }`}
                aria-label={`Go to descent ${idx + 1}`}
              />
            ))}
          </div>
        </div>
      </div>
    </>
  )
}

