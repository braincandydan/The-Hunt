'use client'

import { useState, useEffect, useRef, useMemo } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { SkiSession, RunCompletion, SkiFeature, DescentSession } from '@/lib/utils/types'
import RunDetailModal from './RunDetailModal'
import booleanPointInPolygon from '@turf/boolean-point-in-polygon'
import { point, polygon } from '@turf/helpers'

interface SessionHistoryClientProps {
  resortSlug: string
  resortName: string
  sessions: SkiSession[]
  completionsBySession: Record<string, RunCompletion[]>
  descentSessionsBySession: Record<string, DescentSession[]>
  completionsByDescentSession: Record<string, RunCompletion[]>
  skiFeatures: SkiFeature[]
}

// Format date nicely
function formatDate(dateStr: string): string {
  const date = new Date(dateStr)
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
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

// Difficulty badge
function DifficultyBadge({ difficulty, size = 'sm' }: { difficulty?: string; size?: 'sm' | 'md' }) {
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
  
  const sizeClass = size === 'md' ? 'w-6 h-6 text-sm' : 'w-4 h-4 text-xs'
  
  return (
    <span className={`inline-flex items-center justify-center rounded-full text-white font-bold ${sizeClass} ${colors[difficulty || ''] || 'bg-gray-400'}`}>
      {icons[difficulty || ''] || '○'}
    </span>
  )
}

// Helper function to check if a point is within resort boundary
function isPointInResortBoundary(lat: number, lng: number, boundary: SkiFeature | null): boolean {
  if (!boundary || !boundary.geometry) return true // If no boundary, allow all points
  
  try {
    const geometry = boundary.geometry
    
    // Handle Polygon geometry
    if (geometry.type === 'Polygon' && geometry.coordinates) {
      const poly = polygon(geometry.coordinates)
      const pt = point([lng, lat]) // GeoJSON format: [lng, lat]
      return booleanPointInPolygon(pt, poly)
    }
    
    // Handle MultiPolygon geometry
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
    
    // If boundary type is not supported, allow all points (fallback)
    return true
  } catch (error) {
    // If there's an error checking the boundary (e.g., invalid geometry),
    // allow the point to pass through (safer to show than hide)
    console.warn('Error checking point in boundary:', error)
    return true
  }
}

// Session card component
function SessionCard({ 
  session, 
  completions,
  descentSessions,
  completionsByDescentSession,
  skiFeatures,
  isExpanded,
  onToggle,
  resortSlug,
  onRunClick
}: { 
  session: SkiSession
  completions: RunCompletion[]
  descentSessions: DescentSession[]
  completionsByDescentSession: Record<string, RunCompletion[]>
  skiFeatures: SkiFeature[]
  isExpanded: boolean
  onToggle: () => void
  resortSlug: string
  onRunClick: (completion: RunCompletion) => void
}) {
  const mapRef = useRef<HTMLDivElement>(null)
  const leafletMapRef = useRef<any>(null)
  const mapInitializingRef = useRef(false) // Track if map initialization is in progress
  const prevExpandedRef = useRef(false) // Track previous expanded state - start as false to detect first expansion
  const [mapLoaded, setMapLoaded] = useState(false)
  const [routeData, setRouteData] = useState<{ type: 'LineString', coordinates: number[][] } | null>(null)
  const [routeLoading, setRouteLoading] = useState(false)
  const prevRouteLoadingRef = useRef(routeLoading) // Track previous route loading state - must be after routeLoading state
  const [calculatedMetrics, setCalculatedMetrics] = useState<{ topSpeed: number; avgSpeed: number; verticalMeters: number } | null>(null)
  const [diagnosticData, setDiagnosticData] = useState<{
    missedDetections: number
    pointsNearRuns: number
    avgDistance: number | null
    closestRun: string | null
  } | null>(null)
  const [showDiagnostics, setShowDiagnostics] = useState(false)
  const supabaseRef = useRef(createClient())
  const supabase = supabaseRef.current
  
  // Get resort boundary
  const resortBoundary = useMemo(() => {
    return skiFeatures.find(f => f.type === 'boundary') || null
  }, [skiFeatures])
  
  // Get unique runs - memoize to prevent unnecessary re-renders
  const uniqueRunIds = useMemo(() => new Set(completions.map(c => c.ski_feature_id)), [completions])
  const uniqueRuns = useMemo(() => skiFeatures.filter(f => uniqueRunIds.has(f.id)), [skiFeatures, uniqueRunIds])
  
  // Count by difficulty
  const byDifficulty = completions.reduce((acc, c) => {
    const feature = skiFeatures.find(f => f.id === c.ski_feature_id)
    const diff = feature?.difficulty || 'other'
    acc[diff] = (acc[diff] || 0) + 1
    return acc
  }, {} as Record<string, number>)
  
  
  // Fetch location history route and calculate metrics (fetch even when collapsed to show metrics)
  useEffect(() => {
    if (routeData !== null || routeLoading) return
    
    const fetchRoute = async () => {
      setRouteLoading(true)
      try {
        const { data: locations, error } = await supabase
          .from('location_history')
          .select('latitude, longitude, altitude_meters, speed_kmh, recorded_at')
          .eq('session_id', session.id)
          .order('recorded_at', { ascending: true })
        
        if (error) {
          console.warn('Error fetching location history:', error)
          setRouteData(null)
        } else if (locations && locations.length >= 2) {
          // Filter locations to only include those within resort boundary
          // If no boundary is defined, show all points
          const filteredLocations = locations.filter(l => 
            isPointInResortBoundary(l.latitude, l.longitude, resortBoundary)
          )
          
          // Only create route if we have at least 2 filtered points
          // If we have filtered locations, use them. Otherwise, if no boundary is defined,
          // use all locations (fallback behavior)
          const locationsToUse = filteredLocations.length >= 2 
            ? filteredLocations 
            : (!resortBoundary ? locations : []) // Only use all locations if no boundary
          
          if (locationsToUse.length >= 2) {
            const route: { type: 'LineString', coordinates: number[][] } = {
              type: 'LineString' as const,
              coordinates: locationsToUse.map(l => {
                const coord: number[] = [l.longitude, l.latitude]
                if (l.altitude_meters !== null && l.altitude_meters !== undefined) {
                  coord.push(l.altitude_meters)
                }
                return coord
              })
            }
            
            // Calculate metrics from filtered location_history
            const speeds = locationsToUse
              .map(l => l.speed_kmh)
              .filter((s): s is number => s !== null && s !== undefined && s > 0)
            
            const topSpeed = speeds.length > 0 ? Math.max(...speeds) : 0
            const avgSpeed = speeds.length > 0 ? speeds.reduce((a, b) => a + b, 0) / speeds.length : 0
            
            // Calculate vertical meters (sum of altitude drops)
            let verticalMeters = 0
            for (let i = 1; i < locationsToUse.length; i++) {
              const prev = locationsToUse[i - 1].altitude_meters
              const curr = locationsToUse[i].altitude_meters
              if (prev !== null && prev !== undefined && curr !== null && curr !== undefined && prev > curr) {
                verticalMeters += prev - curr
              }
            }
            
            setCalculatedMetrics({ topSpeed, avgSpeed, verticalMeters })
            setRouteData(route)
          } else {
            // Not enough points within boundary (or no boundary and no points)
            // Still set routeData to null, but session will still show if it has completions
            setRouteData(null)
            setCalculatedMetrics(null)
          }
        } else {
          setRouteData(null)
          setCalculatedMetrics(null)
        }
      } catch (err) {
        console.warn('Error fetching route:', err)
        setRouteData(null)
      } finally {
        setRouteLoading(false)
      }
    }
    
    fetchRoute()
  }, [session.id, routeData, routeLoading, supabase, resortBoundary])
  
  // Fetch diagnostic data for missed run detections
  useEffect(() => {
    if (!isExpanded || !showDiagnostics) return
    
    const fetchDiagnostics = async () => {
      try {
        const { data, error } = await supabase.rpc('diagnose_undetected_runs_summary', {
          p_session_id: session.id,
          p_proximity_threshold: 30,
          p_sample_rate: 10
        })
        
        if (error) {
          console.warn('Error fetching diagnostics:', error)
          return
        }
        
        if (data && data.length > 0) {
          const summary = data[0]
          setDiagnosticData({
            missedDetections: summary.missed_detections || 0,
            pointsNearRuns: summary.points_near_runs || 0,
            avgDistance: summary.avg_distance || null,
            closestRun: summary.closest_run_name || null
          })
        }
      } catch (err) {
        console.warn('Error fetching diagnostic data:', err)
      }
    }
    
    fetchDiagnostics()
  }, [session.id, isExpanded, showDiagnostics, supabase])
  
  // Reset route data and cleanup map when collapsed
  useEffect(() => {
    if (!isExpanded) {
      setRouteData(null)
      setMapLoaded(false)
      mapInitializingRef.current = false // Reset initialization flag
      // Clean up map when collapsed
      if (leafletMapRef.current) {
        try {
          leafletMapRef.current.remove()
        } catch (e) {
          // Map might already be removed, ignore error
          console.warn('Error removing map:', e)
        }
        leafletMapRef.current = null
      }
      // Clear Leaflet's internal reference from container - use querySelector as fallback
      const container = mapRef.current || (document.querySelector(`[data-session-map="${session.id}"]`) as HTMLElement)
      if (container && (container as any)._leaflet_id) {
        delete (container as any)._leaflet_id
      }
    }
  }, [isExpanded, session.id])
  
  // Load map when expanded and route data is ready (or if no route)
  useEffect(() => {
    // Early return if collapsed - no need to do anything
    // Cleanup is handled by the separate cleanup effect
    if (!isExpanded) {
      // Reset all state when collapsed (div will be unmounted by React key)
      const wasExpanded = prevExpandedRef.current
      prevExpandedRef.current = false // Reset to false so next expansion is detected
      prevRouteLoadingRef.current = routeLoading
      if (leafletMapRef.current) {
        leafletMapRef.current = null
      }
      setMapLoaded(false)
      mapInitializingRef.current = false
      return
    }
    
    // Store previous values BEFORE checking (to detect transitions)
    const wasExpanded = prevExpandedRef.current
    const wasRouteLoading = prevRouteLoadingRef.current
    prevExpandedRef.current = isExpanded
    prevRouteLoadingRef.current = routeLoading
    
    // Only initialize map when expanding (transitioning from collapsed to expanded)
    // OR when route finishes loading while already expanded (but map not yet loaded)
    const isExpanding = !wasExpanded && isExpanded
    // Route just finished if we're expanded, route was loading but now isn't, and map is not loaded
    const routeJustFinished = isExpanded && wasRouteLoading && !routeLoading && !mapLoaded
    
    if (!mapRef.current || mapLoaded || mapInitializingRef.current) {
      return
    }
    
    // Only proceed if we're expanding OR route just finished loading
    if (!isExpanding && !routeJustFinished) {
      return
    }
    
    // Wait for route to finish loading - routeData will be set (or null) when done
    if (routeLoading) {
      return
    }
    // If routeData is still null but we've finished loading, that means no route exists
    // Proceed with map loading in either case
    
    // Set initialization flag to prevent concurrent initializations
    mapInitializingRef.current = true
    
    const loadMap = async () => {
      const L = (await import('leaflet')).default
      await import('leaflet/dist/leaflet.css')
      
      // Double-check conditions after async import
      if (!mapRef.current || leafletMapRef.current) {
        return
      }
      
      // Check if container already has a Leaflet map instance
      // Also check via querySelector as fallback in case ref is stale
      const container = mapRef.current || (document.querySelector(`[data-session-map="${session.id}"]`) as HTMLElement)
      if (container && (container as any)._leaflet_id) {
        // If we have a leaflet ref, the map is already initialized
        if (leafletMapRef.current) {
          mapInitializingRef.current = false
          setMapLoaded(true)
          return
        }
        // If _leaflet_id exists but our ref is null, the map was removed but ID wasn't cleared
        // Clear it and proceed with creating a new map
        delete (container as any)._leaflet_id
      }
      
      // Calculate bounds from route segments OR completed runs
      let bounds: [[number, number], [number, number]] | null = null
      let routeSegments: number[][][] = []
      
      // First, try to use route data (will be processed into segments later)
      if (routeData && routeData.coordinates.length > 0) {
        for (const coord of routeData.coordinates) {
          const lat = coord[1]
          const lng = coord[0]
          if (!bounds) {
            bounds = [[lat, lng], [lat, lng]]
          } else {
            bounds[0][0] = Math.min(bounds[0][0], lat)
            bounds[0][1] = Math.min(bounds[0][1], lng)
            bounds[1][0] = Math.max(bounds[1][0], lat)
            bounds[1][1] = Math.max(bounds[1][1], lng)
          }
        }
      }
      
      // Fallback to completed runs if no route
      if (!bounds) {
        // Compute unique runs inside effect to avoid dependency issues
        const uniqueRunIdsInEffect = new Set(completions.map(c => c.ski_feature_id))
        const uniqueRunsInEffect = skiFeatures.filter(f => uniqueRunIdsInEffect.has(f.id))
        for (const feature of uniqueRunsInEffect) {
          if (feature.geometry.type === 'LineString') {
            for (const coord of feature.geometry.coordinates) {
              const lat = coord[1]
              const lng = coord[0]
              if (!bounds) {
                bounds = [[lat, lng], [lat, lng]]
              } else {
                bounds[0][0] = Math.min(bounds[0][0], lat)
                bounds[0][1] = Math.min(bounds[0][1], lng)
                bounds[1][0] = Math.max(bounds[1][0], lat)
                bounds[1][1] = Math.max(bounds[1][1], lng)
              }
            }
          }
        }
      }
      
      if (!bounds) {
        bounds = [[39.5, -106.0], [39.6, -105.9]] // Default fallback
      }
      
      const center: [number, number] = [
        (bounds[0][0] + bounds[1][0]) / 2,
        (bounds[0][1] + bounds[1][1]) / 2
      ]
      
      // Final check before creating map
      if (!mapRef.current || (mapRef.current as any)._leaflet_id) {
        console.warn('Map container not available or already initialized')
        return
      }
      
      const map = L.map(mapRef.current, {
        center,
        zoom: 13,
        zoomControl: false,
        attributionControl: false
      })
      
      // Add satellite tile layer
      L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        attribution: '© <a href="https://www.esri.com">Esri</a>, Maxar, Earthstar Geographics',
        maxZoom: 19
      }).addTo(map)
      
      // Draw GPS route from location_history (if available)
      // Split into segments to avoid drawing lines when tracking was off
      if (routeData && routeData.coordinates.length >= 2) {
        // Import haversineDistance for distance calculation
        const { haversineDistance } = await import('@/lib/utils/run-tracking')
        
        // Get the original locations with timestamps to detect gaps
        const { data: locations } = await supabase
          .from('location_history')
          .select('latitude, longitude, recorded_at')
          .eq('session_id', session.id)
          .order('recorded_at', { ascending: true })
        
        if (locations && locations.length >= 2) {
          // Filter locations to only include those within resort boundary
          const filteredLocations = locations.filter(l => 
            isPointInResortBoundary(l.latitude, l.longitude, resortBoundary)
          )
          
          if (filteredLocations.length >= 2) {
            const MAX_TIME_GAP_MS = 5 * 60 * 1000 // 5 minutes
            const MAX_DISTANCE_METERS = 1000 // 1km
            
            // Split locations into segments based on time/distance gaps
            const segments: number[][][] = []
            let currentSegment: number[][] = []
            
            for (let i = 0; i < filteredLocations.length; i++) {
              const loc = filteredLocations[i]
              const coord = [loc.longitude, loc.latitude] as number[]
            
              if (i === 0) {
                // First point always starts a segment
                currentSegment.push(coord)
              } else {
                const prevLoc = filteredLocations[i - 1]
                const timeDiff = new Date(loc.recorded_at).getTime() - new Date(prevLoc.recorded_at).getTime()
                const distance = haversineDistance(
                  prevLoc.latitude,
                  prevLoc.longitude,
                  loc.latitude,
                  loc.longitude
                )
                
                // If gap is too large, start a new segment
                if (timeDiff > MAX_TIME_GAP_MS || distance > MAX_DISTANCE_METERS) {
                  // Save current segment if it has at least 2 points
                  if (currentSegment.length >= 2) {
                    segments.push(currentSegment)
                  }
                  // Start new segment
                  currentSegment = [coord]
                } else {
                  // Continue current segment
                  currentSegment.push(coord)
                }
              }
            }
            
            // Add the last segment if it has at least 2 points
            if (currentSegment.length >= 2) {
              segments.push(currentSegment)
            }
          
            // Store segments for bounds calculation
            routeSegments = segments
            
            // Recalculate bounds from segments
            if (segments.length > 0) {
              bounds = null
              for (const segment of segments) {
                for (const coord of segment) {
                  const lat = coord[1]
                  const lng = coord[0]
                  if (!bounds) {
                    bounds = [[lat, lng], [lat, lng]]
                  } else {
                    bounds[0][0] = Math.min(bounds[0][0], lat)
                    bounds[0][1] = Math.min(bounds[0][1], lng)
                    bounds[1][0] = Math.max(bounds[1][0], lat)
                    bounds[1][1] = Math.max(bounds[1][1], lng)
                  }
                }
              }
            }
            
            // Draw GPS tracking route as orange lines for testing/comparison
            // This shows the raw GPS track so we can compare it to detected run lines
            const routeColor = '#f97316' // Orange for GPS tracking data
            
            for (const segment of segments) {
              const segmentCoords = segment.map(c => [c[1], c[0]] as [number, number])
              L.polyline(segmentCoords, {
                color: routeColor,
                weight: 2,
                opacity: 0.6,
                smoothFactor: 1,
                dashArray: '5, 5' // Dashed line to distinguish from run lines
              }).addTo(map)
            }
          }
        }
      }
      
      // Draw all trails first (faded background for context)
      const difficultyColors: Record<string, string> = {
        'green': '#22c55e',
        'blue': '#3b82f6',
        'black': '#1f2937',
        'double-black': '#7c3aed', // Purple for double-black
        'terrain-park': '#f97316',
        'other': '#9ca3af'
      }
      
      // Draw all trails as faded background
      // Only show trails (not lifts, boundaries, etc.)
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
        
        // Draw each line segment with faded styling
        for (const coords of coordsToDraw) {
          const leafletCoords = coords.map(c => [c[1], c[0]] as [number, number])
          L.polyline(leafletCoords, {
            color: color,
            weight: 2, // Thinner than user tracks
            opacity: 0.3, // Faded out
            lineCap: 'round',
            lineJoin: 'round',
            interactive: false // Don't show popups on background trails
          }).addTo(map)
        }
      }
      
      // Draw each run segment using its GPS track (actual path taken)
      // These will appear on top of the faded trails
      // This shows the complete descent journey including partial runs and transitions
      for (const completion of completions) {
        // Get feature for difficulty color (even for off-trail segments that have associated_run_id)
        const feature = completion.ski_feature || skiFeatures.find(f => f.id === completion.ski_feature_id)
        const isOffTrail = completion.segment_type === 'off_trail'
        
        // Get difficulty color - use amber for off-trail, otherwise use feature difficulty
        let color: string
        if (isOffTrail) {
          color = '#f59e0b' // Amber for off-trail
        } else if (feature) {
          const difficulty = feature.difficulty || 'other'
          color = difficultyColors[difficulty] || difficultyColors['other']
        } else {
          color = difficultyColors['other']
        }
        
        // Use GPS track from completion if available (actual path taken)
        if (completion.gps_track && completion.gps_track.type === 'LineString' && completion.gps_track.coordinates.length >= 2) {
          const leafletCoords = completion.gps_track.coordinates.map((c: number[]) => [c[1], c[0]] as [number, number])
          const line = L.polyline(leafletCoords, {
            color: color,
            weight: isOffTrail ? 4 : 5,
            opacity: isOffTrail ? 0.7 : 0.95,
            lineCap: 'round',
            lineJoin: 'round',
            dashArray: isOffTrail ? '8, 4' : undefined // Dashed for off-trail
          }).addTo(map)
          
          // Add popup with completion info
          const completionPercent = completion.completion_percentage !== null && completion.completion_percentage !== undefined
            ? `${completion.completion_percentage.toFixed(0)}%`
            : 'N/A'
          const runName = isOffTrail 
            ? `Off-trail (from ${feature?.name || 'Unknown'})`
            : (feature?.name || 'Unknown Run')
          line.bindPopup(`
            <div class="text-sm">
              <div class="font-semibold">${runName}</div>
              ${!isOffTrail ? `<div>Completed: ${completionPercent}</div>` : ''}
              ${completion.top_speed_kmh ? `<div>Top Speed: ${completion.top_speed_kmh.toFixed(0)} km/h</div>` : ''}
              ${completion.duration_seconds ? `<div>Duration: ${Math.floor(completion.duration_seconds / 60)}:${String(completion.duration_seconds % 60).padStart(2, '0')}</div>` : ''}
            </div>
          `)
        } else if (feature && feature.geometry && !isOffTrail) {
          // Fallback: draw full run line if GPS track not available (for older data)
          let coordsToDraw: number[][][] = []
          
          if (feature.geometry.type === 'LineString') {
            coordsToDraw = [feature.geometry.coordinates]
          } else if (feature.geometry.type === 'MultiLineString') {
            coordsToDraw = feature.geometry.coordinates
          } else {
            continue
          }
          
          const difficulty = feature.difficulty || 'other'
          const fallbackColor = difficultyColors[difficulty] || difficultyColors['other']
          
          for (const coords of coordsToDraw) {
            const leafletCoords = coords.map(c => [c[1], c[0]] as [number, number])
            L.polyline(leafletCoords, {
              color: fallbackColor,
              weight: 4,
              opacity: 0.6,
              lineCap: 'round',
              lineJoin: 'round',
              dashArray: '2, 2' // Dashed to indicate it's a fallback (no GPS track)
            }).addTo(map)
          }
        }
      }
      
      // Fit bounds with error handling
      try {
        if (bounds) {
          // Use setTimeout to ensure map tiles are loaded before fitting bounds
          setTimeout(() => {
            try {
              if (leafletMapRef.current && mapRef.current) {
                leafletMapRef.current.fitBounds(bounds, { padding: [20, 20] })
              }
            } catch (e) {
              console.warn('Error fitting bounds:', e)
            }
          }, 100)
        }
      } catch (e) {
        console.warn('Error setting up bounds:', e)
      }
      
      leafletMapRef.current = map
      mapInitializingRef.current = false
      setMapLoaded(true)
    }
    
    loadMap().catch((err) => {
      // Reset flag on error
      mapInitializingRef.current = false
      console.error('Error loading map:', err)
    })
    
    return () => {
      // Cleanup on unmount or when dependencies change
      if (leafletMapRef.current) {
        try {
          // Store the container reference before it might become null
          const container = mapRef.current
          // Check if map container still exists before removing
          if (container) {
            try {
              leafletMapRef.current.remove()
            } catch (e) {
              // Map might already be removed
              console.warn('Error removing map:', e)
            }
            // Clear Leaflet's internal reference - use stored container reference
            if ((container as any)._leaflet_id) {
              delete (container as any)._leaflet_id
            }
          } else {
            // Container is null, but try to find it via querySelector as fallback
            // This handles the case where React unmounts the element but it still exists in DOM temporarily
            const mapContainer = document.querySelector(`[data-session-map="${session.id}"]`) as HTMLElement
            if (mapContainer && (mapContainer as any)._leaflet_id) {
              delete (mapContainer as any)._leaflet_id
            }
          }
        } catch (e) {
          // Container might not exist
          console.warn('Error cleaning up map container:', e)
        }
        leafletMapRef.current = null
      }
      mapInitializingRef.current = false // Reset initialization flag
      setMapLoaded(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    // completions and skiFeatures are used inside the effect but don't need to be dependencies
    // routeLoading is tracked via ref to avoid triggering effect on every change
    // routeData is included so map redraws when route data becomes available
    // We only want to re-run when isExpanded, session.id, routeData, or resortBoundary changes
  }, [isExpanded, session.id, routeData, resortBoundary])
  
  // Separate effect to draw route when routeData becomes available after map is loaded
  useEffect(() => {
    if (!isExpanded || !mapLoaded || !leafletMapRef.current || !routeData || routeData.coordinates.length < 2) {
      return
    }
    
    const drawRoute = async () => {
      const L = (await import('leaflet')).default
      const { haversineDistance } = await import('@/lib/utils/run-tracking')
      const map = leafletMapRef.current
      
      if (!map) return
      
      // Get the original locations with timestamps to detect gaps
      const { data: locations } = await supabase
        .from('location_history')
        .select('latitude, longitude, recorded_at')
        .eq('session_id', session.id)
        .order('recorded_at', { ascending: true })
      
      if (locations && locations.length >= 2) {
        // Filter locations to only include those within resort boundary
        const filteredLocations = locations.filter(l => 
          isPointInResortBoundary(l.latitude, l.longitude, resortBoundary)
        )
        
        if (filteredLocations.length >= 2) {
          const MAX_TIME_GAP_MS = 5 * 60 * 1000 // 5 minutes
          const MAX_DISTANCE_METERS = 1000 // 1km
          
          // Split locations into segments based on time/distance gaps
          const segments: number[][][] = []
          let currentSegment: number[][] = []
          
          for (let i = 0; i < filteredLocations.length; i++) {
            const loc = filteredLocations[i]
            const coord = [loc.longitude, loc.latitude] as number[]
          
            if (i === 0) {
              currentSegment.push(coord)
            } else {
              const prevLoc = filteredLocations[i - 1]
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
                }
                currentSegment = [coord]
              } else {
                currentSegment.push(coord)
              }
            }
          }
          
          if (currentSegment.length >= 2) {
            segments.push(currentSegment)
          }
          
          // Draw each segment as a separate polyline
          // Draw GPS tracking route as orange lines for testing/comparison
          // This shows the raw GPS track so we can compare it to detected run lines
          const routeColor = '#f97316' // Orange for GPS tracking data
          
          for (const segment of segments) {
            const segmentCoords = segment.map(c => [c[1], c[0]] as [number, number])
            L.polyline(segmentCoords, {
              color: routeColor,
              weight: 2,
              opacity: 0.6,
              smoothFactor: 1,
              dashArray: '5, 5' // Dashed line to distinguish from run lines
            }).addTo(map)
          }
          
          // Fit bounds to show the route
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
              setTimeout(() => {
                if (map) {
                  map.fitBounds(routeBounds!, { padding: [20, 20] })
                }
              }, 100)
            }
          }
        }
      }
    }
    
    drawRoute().catch(console.error)
  }, [isExpanded, mapLoaded, routeData, session.id, completions.length, resortBoundary, supabase])

  // Use calculated metrics from location_history if available, otherwise use session data
  const topSpeed = calculatedMetrics?.topSpeed || session.top_speed_kmh || 0
  const avgSpeed = calculatedMetrics?.avgSpeed || session.avg_speed_kmh || 0
  const verticalMeters = calculatedMetrics?.verticalMeters || session.total_vertical_meters || 0

  return (
    <div className="bg-gray-800/50 rounded-xl border border-white/10 overflow-hidden">
      {/* Header - clickable */}
      <button
        onClick={onToggle}
        className="w-full px-4 py-4 flex items-center justify-between hover:bg-white/5 transition-colors"
      >
        <div className="flex items-center gap-4">
          <div className="text-left">
            <div className="font-semibold text-white text-lg">
              {formatDate(session.session_date)}
            </div>
            <div className="text-sm text-gray-400">
              {completions.length > 0 ? (
                <>
                  {completions.length} runs • {uniqueRunIds.size} unique
                </>
              ) : routeData && routeData.coordinates.length > 0 ? (
                <span className="flex items-center gap-1.5">
                  <span className="w-2 h-2 bg-purple-500 rounded-full"></span>
                  Tracked route (no runs)
                </span>
              ) : (
                'No tracked data'
              )}
            </div>
          </div>
        </div>
        
        <div className="flex items-center gap-4">
          {/* Difficulty pills */}
          <div className="hidden sm:flex items-center gap-2">
            {Object.entries(byDifficulty).map(([diff, count]) => (
              <div key={diff} className="flex items-center gap-1 bg-white/10 rounded-full px-2 py-1">
                <DifficultyBadge difficulty={diff} />
                <span className="text-xs text-gray-300">×{count}</span>
              </div>
            ))}
          </div>
          
          {/* Speed and elevation metrics */}
          <div className="flex items-center gap-4 text-right">
            {/* Top speed */}
            {(topSpeed > 0 || avgSpeed > 0 || completions.length > 0) && (
              <div>
                <div className="text-sm font-bold text-white">
                  {topSpeed > 0 ? topSpeed.toFixed(0) : '—'}
                </div>
                <div className="text-xs text-gray-400">Top km/h</div>
              </div>
            )}
            
            {/* Average speed */}
            {avgSpeed > 0 && (
              <div>
                <div className="text-sm font-bold text-white">{avgSpeed.toFixed(1)}</div>
                <div className="text-xs text-gray-400">Avg km/h</div>
              </div>
            )}
            
            {/* Vertical meters */}
            {verticalMeters > 0 && (
              <div>
                <div className="text-sm font-bold text-white">{verticalMeters.toFixed(0)}</div>
                <div className="text-xs text-gray-400">Vertical m</div>
              </div>
            )}
          </div>
          
          <svg 
            className={`w-5 h-5 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
            fill="none" 
            stroke="currentColor" 
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>
      
      {/* Expanded content */}
      {isExpanded && (
        <div className="border-t border-white/10">
          {/* Mini map */}
          <div className="relative h-48 bg-gray-900">
            {!mapLoaded && mapInitializingRef.current && (
              <div className="absolute inset-0 flex items-center justify-center bg-gray-900 z-10">
                <div className="text-gray-400 text-sm">Loading map...</div>
              </div>
            )}
            <div 
              ref={mapRef} 
              data-session-map={session.id} 
              className="h-full w-full"
            />
          </div>
          
          {/* Diagnostic panel */}
          {isExpanded && (
            <div className="px-4 pt-4 border-b border-white/10">
              <button
                onClick={() => setShowDiagnostics(!showDiagnostics)}
                className="w-full flex items-center justify-between text-xs text-gray-400 hover:text-gray-300 transition-colors"
              >
                <span className="flex items-center gap-2">
                  <span>🔍</span>
                  <span>Run Detection Diagnostics</span>
                </span>
                <svg 
                  className={`w-4 h-4 transition-transform ${showDiagnostics ? 'rotate-180' : ''}`}
                  fill="none" 
                  stroke="currentColor" 
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              
              {showDiagnostics && (
                <div className="mt-3 pb-4 space-y-2 text-xs">
                  {diagnosticData ? (
                    <>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="bg-yellow-500/10 border border-yellow-500/30 rounded p-2">
                          <div className="text-yellow-400 font-semibold">{diagnosticData.missedDetections}</div>
                          <div className="text-yellow-300/70">Missed Detections</div>
                        </div>
                        <div className="bg-blue-500/10 border border-blue-500/30 rounded p-2">
                          <div className="text-blue-400 font-semibold">{diagnosticData.pointsNearRuns}</div>
                          <div className="text-blue-300/70">Points Near Runs</div>
                        </div>
                      </div>
                      {diagnosticData.avgDistance !== null && (
                        <div className="text-gray-400">
                          Avg distance: {diagnosticData.avgDistance.toFixed(1)}m
                          {diagnosticData.closestRun && (
                            <span className="ml-2">• Closest: {diagnosticData.closestRun}</span>
                          )}
                        </div>
                      )}
                      {diagnosticData.missedDetections > 0 && (
                        <div className="text-yellow-400 text-xs mt-2 p-2 bg-yellow-500/10 rounded border border-yellow-500/30">
                          ⚠️ {diagnosticData.missedDetections} GPS points were within 30m of runs but didn't result in completions.
                          This may indicate the proximity threshold needs adjustment or there were tracking issues.
                        </div>
                      )}
                      {diagnosticData.missedDetections === 0 && (
                        <div className="text-green-400 text-xs mt-2">
                          ✓ All GPS points near runs were successfully detected
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="text-gray-500">Loading diagnostics...</div>
                  )}
                  <div className="text-gray-500 text-xs mt-2 pt-2 border-t border-white/10">
                    Tip: Run <code className="bg-gray-900 px-1 rounded">SELECT * FROM diagnose_undetected_runs('{session.id}')</code> in Supabase SQL Editor for detailed analysis
                  </div>
                </div>
              )}
            </div>
          )}
          
          {/* Descent Sessions or Run list */}
          <div className="p-4 space-y-2 max-h-64 overflow-y-auto">
            {descentSessions.length > 0 ? (
              <>
                <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
                  Descent Sessions
                </h4>
                {descentSessions.map((descent, descentIdx) => {
                  const segments = completionsByDescentSession[descent.id] || []
                  const duration = descent.ended_at 
                    ? Math.round((new Date(descent.ended_at).getTime() - new Date(descent.started_at).getTime()) / 1000)
                    : null
                  return (
                    <div key={descent.id} className="mb-4 last:mb-0">
                      <div className="bg-white/5 rounded-lg p-3 mb-2">
                        <div className="flex items-center justify-between mb-2">
                          <div className="text-sm font-semibold text-white">
                            Descent {descentIdx + 1}
                          </div>
                          <div className="text-xs text-gray-400">
                            {segments.length} {segments.length === 1 ? 'segment' : 'segments'}
                          </div>
                        </div>
                        
                        {/* Time range */}
                        <div className="text-xs text-gray-400 mb-2">
                          <div className="flex items-center gap-2">
                            <span>🕐</span>
                            <span>
                              {formatTime(descent.started_at)}
                              {descent.ended_at && ` - ${formatTime(descent.ended_at)}`}
                              {duration && ` (${Math.floor(duration / 60)}:${String(duration % 60).padStart(2, '0')})`}
                            </span>
                          </div>
                        </div>
                        
                        {/* Stats grid */}
                        <div className="grid grid-cols-2 gap-2 mt-2">
                          {descent.total_vertical_meters > 0 && (
                            <div className="text-xs">
                              <div className="text-gray-400">Vertical</div>
                              <div className="text-white font-medium">{descent.total_vertical_meters.toFixed(0)} m</div>
                            </div>
                          )}
                          {descent.total_distance_meters > 0 && (
                            <div className="text-xs">
                              <div className="text-gray-400">Distance</div>
                              <div className="text-white font-medium">{(descent.total_distance_meters / 1000).toFixed(2)} km</div>
                            </div>
                          )}
                          {descent.top_speed_kmh > 0 && (
                            <div className="text-xs">
                              <div className="text-gray-400">Top Speed</div>
                              <div className="text-white font-medium">{descent.top_speed_kmh.toFixed(0)} km/h</div>
                            </div>
                          )}
                          {descent.avg_speed_kmh > 0 && (
                            <div className="text-xs">
                              <div className="text-gray-400">Avg Speed</div>
                              <div className="text-white font-medium">{descent.avg_speed_kmh.toFixed(1)} km/h</div>
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="space-y-1 pl-2 border-l-2 border-gray-700">
                        {segments.map((completion, i) => {
                          const feature = skiFeatures.find(f => f.id === completion.ski_feature_id)
                          const isOffTrail = completion.segment_type === 'off_trail'
                          return (
                            <button
                              key={completion.id}
                              onClick={() => onRunClick(completion)}
                              className="w-full flex items-center gap-3 py-2 px-3 bg-white/5 rounded-lg hover:bg-white/10 transition-colors text-left"
                            >
                              <span className="text-gray-500 text-sm w-6">{i + 1}.</span>
                              {isOffTrail ? (
                                <span className="w-4 h-4 text-xs text-amber-400">🌲</span>
                              ) : (
                                <DifficultyBadge difficulty={feature?.difficulty ?? undefined} />
                              )}
                              <span className="flex-1 font-medium text-white truncate">
                                {isOffTrail 
                                  ? `Off-trail (from ${feature?.name || 'Unknown'})`
                                  : (feature?.name || 'Unknown Run')
                                }
                                {!isOffTrail && completion.completion_percentage !== null && completion.completion_percentage !== undefined && (
                                  <span className="ml-2 text-xs text-gray-400 font-normal">
                                    ({completion.completion_percentage.toFixed(0)}%)
                                  </span>
                                )}
                              </span>
                              {completion.top_speed_kmh && (
                                <span className="text-xs text-gray-400">
                                  {completion.top_speed_kmh.toFixed(0)} km/h
                                </span>
                              )}
                              {completion.duration_seconds && (
                                <span className="text-xs text-gray-400">
                                  {Math.floor(completion.duration_seconds / 60)}:{String(completion.duration_seconds % 60).padStart(2, '0')}
                                </span>
                              )}
                              <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                              </svg>
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
                
                {/* Show runs that aren't in any descent session */}
                {(() => {
                  const runsInDescents = new Set(
                    Object.values(completionsByDescentSession).flat().map(c => c.id)
                  )
                  const unassociatedRuns = completions.filter(
                    c => c.ski_feature_id && !runsInDescents.has(c.id)
                  )
                  
                  if (unassociatedRuns.length > 0) {
                    return (
                      <div className="mt-4 pt-4 border-t border-yellow-500/30">
                        <div className="text-xs text-yellow-400 mb-2 font-medium flex items-center gap-2">
                          <span>⚠️</span>
                          <span>Unassociated Runs ({unassociatedRuns.length})</span>
                        </div>
                        <div className="text-xs text-yellow-300/70 mb-2">
                          These runs are tracked but not in a descent session. They may need to be retroactively associated.
                        </div>
                        <div className="space-y-1 pl-2 border-l-2 border-yellow-500/30">
                          {unassociatedRuns.map((completion, i) => {
                            const feature = skiFeatures.find(f => f.id === completion.ski_feature_id)
                            return (
                              <button
                                key={completion.id}
                                onClick={() => onRunClick(completion)}
                                className="w-full flex items-center gap-3 py-2 px-3 bg-yellow-500/10 rounded-lg hover:bg-yellow-500/20 transition-colors text-left"
                              >
                                <span className="text-yellow-400 text-sm w-6">{i + 1}.</span>
                                <DifficultyBadge difficulty={feature?.difficulty ?? undefined} />
                                <span className="flex-1 font-medium text-white truncate">
                                  {feature?.name || 'Unknown Run'}
                                </span>
                                {completion.top_speed_kmh && (
                                  <span className="text-xs text-yellow-300/70">
                                    {completion.top_speed_kmh.toFixed(0)} km/h
                                  </span>
                                )}
                                {completion.duration_seconds && (
                                  <span className="text-xs text-yellow-300/70">
                                    {Math.floor(completion.duration_seconds / 60)}:{String(completion.duration_seconds % 60).padStart(2, '0')}
                                  </span>
                                )}
                                <svg className="w-4 h-4 text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                </svg>
                              </button>
                            )
                          })}
                        </div>
                      </div>
                    )
                  }
                  return null
                })()}
              </>
            ) : (
              <>
                <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
                  Runs Completed
                </h4>
                {completions.map((completion, i) => {
                  const feature = skiFeatures.find(f => f.id === completion.ski_feature_id)
                  const isUnassociated = !completion.descent_session_id
                  return (
                    <button
                      key={completion.id}
                      onClick={() => onRunClick(completion)}
                      className={`w-full flex items-center gap-3 py-2 px-3 rounded-lg hover:bg-white/10 transition-colors text-left ${
                        isUnassociated ? 'bg-yellow-500/10 border border-yellow-500/30' : 'bg-white/5'
                      }`}
                    >
                      <span className={`text-sm w-6 ${isUnassociated ? 'text-yellow-400' : 'text-gray-500'}`}>
                        {i + 1}.
                        {isUnassociated && <span className="ml-1">⚠️</span>}
                      </span>
                      <DifficultyBadge difficulty={feature?.difficulty ?? undefined} />
                      <span className="flex-1 font-medium text-white truncate">
                        {feature?.name || 'Unknown Run'}
                      </span>
                      {isUnassociated && (
                        <span className="text-xs text-yellow-400" title="Not in a descent session">
                          Unassociated
                        </span>
                      )}
                      {completion.top_speed_kmh && (
                        <span className="text-xs text-gray-400">
                          {completion.top_speed_kmh.toFixed(0)} km/h
                        </span>
                      )}
                      {completion.duration_seconds && (
                        <span className="text-xs text-gray-400">
                          {Math.floor(completion.duration_seconds / 60)}:{String(completion.duration_seconds % 60).padStart(2, '0')}
                        </span>
                      )}
                      <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    </button>
                  )
                })}
                
                {completions.length === 0 && (
                  <div className="text-center py-8 text-gray-400">
                    <p>No runs recorded for this session</p>
                    {routeData && routeData.coordinates.length > 0 && (
                      <div className="mt-2 space-y-1">
                        <p className="text-xs text-gray-500">
                          GPS route is shown on the map above
                        </p>
                        <p className="text-xs text-purple-400 flex items-center justify-center gap-1">
                          <span className="w-2 h-2 bg-purple-500 rounded-full"></span>
                          Tracked route (not associated with a trail)
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default function SessionHistoryClient({
  resortSlug,
  resortName,
  sessions,
  completionsBySession,
  descentSessionsBySession,
  completionsByDescentSession,
  skiFeatures
}: SessionHistoryClientProps) {

  const router = useRouter()
  const [expandedSession, setExpandedSession] = useState<string | null>(
    sessions.length > 0 ? sessions[0].id : null
  )
  const [selectedRun, setSelectedRun] = useState<RunCompletion | null>(null)
  
  const handleRefresh = () => {
    // Clean up all maps before refreshing
    // This will be handled by cleanup effects, but we can also force cleanup here
    // Use window.location.reload() for a full page refresh to ensure clean state
    window.location.reload()
  }
  
  // Calculate totals
  const totalRuns = sessions.reduce((sum, s) => sum + s.total_runs, 0)
  const allCompletions = Object.values(completionsBySession).flat()
  const uniqueRunIds = new Set(allCompletions.map(c => c.ski_feature_id))
  const topSpeed = Math.max(...sessions.map(s => s.top_speed_kmh || 0), 0)
  
  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-slate-900 to-gray-900">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-gray-900/80 backdrop-blur-xl border-b border-white/10">
        <div className="max-w-2xl mx-auto px-4 py-4 flex items-center gap-4">
          <Link 
            href={`/${resortSlug}/game/map`}
            className="p-2 rounded-lg hover:bg-white/10 transition-colors"
          >
            <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <div className="flex-1">
            <h1 className="text-xl font-bold text-white">Session History</h1>
            <p className="text-sm text-gray-400">{resortName}</p>
          </div>
          <button
            onClick={handleRefresh}
            className="p-2 rounded-lg hover:bg-white/10 transition-colors"
            aria-label="Refresh page"
          >
            <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
        </div>
      </header>
      
      <main className="max-w-2xl mx-auto px-4 py-6">
        {/* Stats overview */}
        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="bg-gradient-to-br from-blue-500/20 to-blue-600/10 rounded-xl p-4 border border-blue-500/20">
            <div className="text-3xl font-bold text-white">{sessions.length}</div>
            <div className="text-sm text-blue-300">Sessions</div>
          </div>
          <div className="bg-gradient-to-br from-green-500/20 to-green-600/10 rounded-xl p-4 border border-green-500/20">
            <div className="text-3xl font-bold text-white">{totalRuns}</div>
            <div className="text-sm text-green-300">Total Runs</div>
          </div>
          <div className="bg-gradient-to-br from-orange-500/20 to-orange-600/10 rounded-xl p-4 border border-orange-500/20">
            <div className="text-3xl font-bold text-white">{topSpeed.toFixed(0)}</div>
            <div className="text-sm text-orange-300">Top km/h</div>
          </div>
        </div>
        
        {/* Unique runs badge */}
        {uniqueRunIds.size > 0 && (
          <div className="mb-6 p-4 bg-gradient-to-r from-purple-500/10 to-pink-500/10 rounded-xl border border-purple-500/20">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm text-gray-400">Runs Explored</div>
                <div className="text-2xl font-bold text-white">
                  {uniqueRunIds.size} / {skiFeatures.filter(f => f.type === 'trail').length}
                </div>
              </div>
              <div className="text-right">
                <div className="text-sm text-gray-400">Completion</div>
                <div className="text-2xl font-bold text-purple-400">
                  {Math.round((uniqueRunIds.size / Math.max(1, skiFeatures.filter(f => f.type === 'trail').length)) * 100)}%
                </div>
              </div>
            </div>
            {/* Progress bar */}
            <div className="mt-3 h-2 bg-gray-700 rounded-full overflow-hidden">
              <div 
                className="h-full bg-gradient-to-r from-purple-500 to-pink-500 transition-all duration-500"
                style={{ 
                  width: `${(uniqueRunIds.size / Math.max(1, skiFeatures.filter(f => f.type === 'trail').length)) * 100}%` 
                }}
              />
            </div>
          </div>
        )}
        
        {/* Session list */}
        <div className="space-y-4">
          <h2 className="text-lg font-semibold text-white">Past Sessions</h2>
          
          {sessions.length === 0 ? (
            <div className="text-center py-12">
              <div className="text-6xl mb-4">🎿</div>
              <h3 className="text-xl font-semibold text-white mb-2">No sessions yet</h3>
              <p className="text-gray-400 mb-6">
                Start skiing with location tracking enabled to record your runs!
              </p>
              <Link
                href={`/${resortSlug}/game/map`}
                className="inline-flex items-center gap-2 px-6 py-3 bg-blue-500 hover:bg-blue-600 text-white font-semibold rounded-xl transition-colors"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
                </svg>
                Open Map
              </Link>
            </div>
          ) : (
            sessions.map(session => (
              <SessionCard
                key={session.id}
                session={session}
                completions={completionsBySession[session.id] || []}
                descentSessions={descentSessionsBySession[session.id] || []}
                completionsByDescentSession={completionsByDescentSession}
                skiFeatures={skiFeatures}
                isExpanded={expandedSession === session.id}
                onToggle={() => setExpandedSession(
                  expandedSession === session.id ? null : session.id
                )}
                resortSlug={resortSlug}
                onRunClick={setSelectedRun}
              />
            ))
          )}
        </div>
      </main>
      
      {/* Run Detail Modal */}
      {selectedRun && (
        <RunDetailModal
          completion={selectedRun}
          skiFeature={skiFeatures.find(f => f.id === selectedRun.ski_feature_id)}
          onClose={() => setSelectedRun(null)}
        />
      )}
    </div>
  )
}



