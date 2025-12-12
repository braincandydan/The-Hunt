'use client'

import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { SkiSession, RunCompletion, SkiFeature } from '@/lib/utils/types'

interface SessionHistoryClientProps {
  resortSlug: string
  resortName: string
  sessions: SkiSession[]
  completionsBySession: Record<string, RunCompletion[]>
  skiFeatures: SkiFeature[]
}

// Format date nicely
function formatDate(dateStr: string): string {
  // Parse date string as local date (not UTC) to avoid timezone issues
  // dateStr is in format "YYYY-MM-DD" from database
  const [year, month, day] = dateStr.split('-').map(Number)
  const date = new Date(year, month - 1, day) // month is 0-indexed
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)
  
  // Compare dates by year/month/day only (ignore time)
  const dateStrFormatted = date.toDateString()
  const todayStrFormatted = today.toDateString()
  const yesterdayStrFormatted = yesterday.toDateString()
  
  if (dateStrFormatted === todayStrFormatted) return 'Today'
  if (dateStrFormatted === yesterdayStrFormatted) return 'Yesterday'
  
  return date.toLocaleDateString('en-US', { 
    weekday: 'long',
    month: 'short', 
    day: 'numeric'
  })
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

// Session card component
function SessionCard({ 
  session, 
  completions,
  skiFeatures,
  isExpanded,
  onToggle,
  resortSlug
}: { 
  session: SkiSession
  completions: RunCompletion[]
  skiFeatures: SkiFeature[]
  isExpanded: boolean
  onToggle: () => void
  resortSlug: string
}) {
  const mapRef = useRef<HTMLDivElement>(null)
  const leafletMapRef = useRef<any>(null)
  const [mapLoaded, setMapLoaded] = useState(false)
  const [routeData, setRouteData] = useState<{ type: 'LineString', coordinates: number[][] } | null>(null)
  const [routeLoading, setRouteLoading] = useState(false)
  const [calculatedMetrics, setCalculatedMetrics] = useState<{ topSpeed: number; avgSpeed: number; verticalMeters: number } | null>(null)
  const supabase = createClient()
  
  // Get unique runs
  const uniqueRunIds = new Set(completions.map(c => c.ski_feature_id))
  const uniqueRuns = skiFeatures.filter(f => uniqueRunIds.has(f.id))
  
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
          const route: { type: 'LineString', coordinates: number[][] } = {
            type: 'LineString' as const,
            coordinates: locations.map(l => {
              const coord: number[] = [l.longitude, l.latitude]
              if (l.altitude_meters !== null && l.altitude_meters !== undefined) {
                coord.push(l.altitude_meters)
              }
              return coord
            })
          }
          
          // Calculate metrics from location_history
          const speeds = locations
            .map(l => l.speed_kmh)
            .filter((s): s is number => s !== null && s !== undefined && s > 0)
          
          const topSpeed = speeds.length > 0 ? Math.max(...speeds) : 0
          const avgSpeed = speeds.length > 0 ? speeds.reduce((a, b) => a + b, 0) / speeds.length : 0
          
          // Calculate vertical meters (sum of altitude drops)
          let verticalMeters = 0
          for (let i = 1; i < locations.length; i++) {
            const prev = locations[i - 1].altitude_meters
            const curr = locations[i].altitude_meters
            if (prev !== null && prev !== undefined && curr !== null && curr !== undefined && prev > curr) {
              verticalMeters += prev - curr
            }
          }
          
          setCalculatedMetrics({ topSpeed, avgSpeed, verticalMeters })
          setRouteData(route)
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
  }, [session.id, routeData, routeLoading, supabase])
  
  // Reset route data and cleanup map when collapsed
  useEffect(() => {
    if (!isExpanded) {
      setRouteData(null)
      setMapLoaded(false)
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
    }
  }, [isExpanded])
  
  // Load map when expanded and route data is ready (or if no route)
  useEffect(() => {
    if (!isExpanded || !mapRef.current || mapLoaded) return
    // Wait for route to finish loading - routeData will be set (or null) when done
    if (routeLoading) return
    // If routeData is still null but we've finished loading, that means no route exists
    // Proceed with map loading in either case
    
    const loadMap = async () => {
      const L = (await import('leaflet')).default
      await import('leaflet/dist/leaflet.css')
      
      if (!mapRef.current || leafletMapRef.current) return
      
      // Calculate bounds from route OR completed runs
      let bounds: [[number, number], [number, number]] | null = null
      
      // First, try to use route data
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
        for (const feature of uniqueRuns) {
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
      
      const map = L.map(mapRef.current, {
        center,
        zoom: 13,
        zoomControl: false,
        attributionControl: false
      })
      
      // Add tile layer
      L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        maxZoom: 19
      }).addTo(map)
      
      // Draw GPS route from location_history (if available)
      if (routeData && routeData.coordinates.length >= 2) {
        const routeCoords = routeData.coordinates.map(c => [c[1], c[0]] as [number, number])
        L.polyline(routeCoords, {
          color: '#3b82f6',
          weight: 3,
          opacity: 0.8,
          smoothFactor: 1
        }).addTo(map)
      }
      
      // Draw completed runs (on top of route)
      const difficultyColors: Record<string, string> = {
        'green': '#22c55e',
        'blue': '#3b82f6',
        'black': '#1f2937',
        'double-black': '#1f2937',
        'terrain-park': '#f97316',
        'other': '#9ca3af'
      }
      
      for (const feature of uniqueRuns) {
        if (feature.geometry.type === 'LineString') {
          const coords = feature.geometry.coordinates.map(c => [c[1], c[0]] as [number, number])
          L.polyline(coords, {
            color: difficultyColors[feature.difficulty || 'other'],
            weight: 4,
            opacity: 0.9
          }).addTo(map)
        }
      }
      
      // Fit bounds
      map.fitBounds(bounds, { padding: [20, 20] })
      
      leafletMapRef.current = map
      setMapLoaded(true)
    }
    
    loadMap()
    
    return () => {
      // Cleanup on unmount or when dependencies change
      if (leafletMapRef.current) {
        try {
          // Check if map container still exists before removing
          if (mapRef.current && leafletMapRef.current.getContainer()) {
            leafletMapRef.current.remove()
          }
        } catch (e) {
          // Map might already be removed or container doesn't exist
          console.warn('Error cleaning up map:', e)
        }
        leafletMapRef.current = null
      }
      setMapLoaded(false)
    }
  }, [isExpanded, uniqueRuns, mapLoaded, routeData, routeLoading])
    
    // Re-render map when route data becomes available after initial load
    useEffect(() => {
      if (!isExpanded || !mapLoaded || !leafletMapRef.current || !routeData || routeData.coordinates.length < 2) return
      
      // Import Leaflet dynamically to ensure it's available
      const addRouteToMap = async () => {
        try {
          const L = (await import('leaflet')).default
          if (!L || !leafletMapRef.current || !mapRef.current) return
          
          // Verify map container still exists
          try {
            leafletMapRef.current.getContainer()
          } catch (e) {
            // Map container doesn't exist, skip
            return
          }
          
          // Remove existing route if any
          leafletMapRef.current.eachLayer((layer: any) => {
            try {
              if (layer.options && layer.options.color === '#3b82f6' && layer.options.weight === 3) {
                leafletMapRef.current.removeLayer(layer)
              }
            } catch (e) {
              // Layer might already be removed, continue
            }
          })
          
          // Draw the route
          const routeCoords = routeData.coordinates.map(c => [c[1], c[0]] as [number, number])
          const routeLine = L.polyline(routeCoords, {
            color: '#3b82f6',
            weight: 3,
            opacity: 0.8,
            smoothFactor: 1
          }).addTo(leafletMapRef.current)
          
          // Recalculate bounds and fit to route
          if (routeCoords.length > 0 && leafletMapRef.current) {
            const bounds = L.latLngBounds(routeCoords)
            // Use setTimeout to ensure map is fully ready
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
        } catch (err) {
          console.warn('Error adding route to map:', err)
        }
      }
      
      addRouteToMap()
    }, [isExpanded, mapLoaded, routeData, session.id])
  

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
              {completions.length} runs • {uniqueRunIds.size} unique
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
          <div ref={mapRef} className="h-48 bg-gray-900" />
          
          {/* Run list */}
          <div className="p-4 space-y-2 max-h-64 overflow-y-auto">
            <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
              Runs Completed
            </h4>
            {completions.map((completion, i) => {
              const feature = skiFeatures.find(f => f.id === completion.ski_feature_id)
              return (
                <div 
                  key={completion.id}
                  className="flex items-center gap-3 py-2 px-3 bg-white/5 rounded-lg"
                >
                  <span className="text-gray-500 text-sm w-6">{i + 1}.</span>
                  <DifficultyBadge difficulty={feature?.difficulty ?? undefined} />
                  <span className="flex-1 font-medium text-white truncate">
                    {feature?.name || 'Unknown Run'}
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
                </div>
              )
            })}
            
            {completions.length === 0 && (
              <div className="text-center py-8 text-gray-400">
                <p>No runs recorded for this session</p>
                {routeData && routeData.coordinates.length > 0 && (
                  <p className="text-xs mt-2 text-gray-500">
                    GPS route is shown on the map above
                  </p>
                )}
              </div>
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
  skiFeatures
}: SessionHistoryClientProps) {

  const router = useRouter()
  const [expandedSession, setExpandedSession] = useState<string | null>(
    sessions.length > 0 ? sessions[0].id : null
  )
  
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
                skiFeatures={skiFeatures}
                isExpanded={expandedSession === session.id}
                onToggle={() => setExpandedSession(
                  expandedSession === session.id ? null : session.id
                )}
                resortSlug={resortSlug}
              />
            ))
          )}
        </div>
      </main>
    </div>
  )
}



