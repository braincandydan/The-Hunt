'use client'

import { useState, useEffect, useRef } from 'react'
import { RunCompletion, SkiFeature } from '@/lib/utils/types'

interface RunDetailModalProps {
  completion: RunCompletion
  skiFeature?: SkiFeature
  onClose: () => void
}

// Difficulty badge component
function DifficultyBadge({ difficulty, size = 'md' }: { difficulty?: string; size?: 'sm' | 'md' | 'lg' }) {
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
  
  const sizeClass = size === 'lg' ? 'w-8 h-8 text-base' : size === 'md' ? 'w-6 h-6 text-sm' : 'w-4 h-4 text-xs'
  
  return (
    <span className={`inline-flex items-center justify-center rounded-full text-white font-bold ${sizeClass} ${colors[difficulty || ''] || 'bg-gray-400'}`}>
      {icons[difficulty || ''] || '○'}
    </span>
  )
}

// Format detection method for display
function formatDetectionMethod(method: string): string {
  const methods: Record<string, string> = {
    'gps_proximity': 'GPS Proximity',
    'manual': 'Manual',
    'qr_scan': 'QR Code Scan'
  }
  return methods[method] || method
}

// Format date/time
function formatDateTime(dateStr: string): string {
  const date = new Date(dateStr)
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  })
}

// Format duration
function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  if (mins > 0) {
    return `${mins}m ${secs}s`
  }
  return `${secs}s`
}

export default function RunDetailModal({ completion, skiFeature, onClose }: RunDetailModalProps) {
  const mapRef = useRef<HTMLDivElement>(null)
  const leafletMapRef = useRef<any>(null)
  const [mapLoaded, setMapLoaded] = useState(false)

  // Load map with run track
  useEffect(() => {
    if (!mapRef.current || mapLoaded || leafletMapRef.current) return

    const loadMap = async () => {
      const L = (await import('leaflet')).default
      await import('leaflet/dist/leaflet.css')
      
      if (!mapRef.current || leafletMapRef.current) return

      // Wait a bit to ensure the modal is fully rendered and visible
      await new Promise(resolve => setTimeout(resolve, 100))

      // Double-check container is still available
      if (!mapRef.current || leafletMapRef.current) return

      // Clear any existing Leaflet instance from the container
      const container = mapRef.current
      if ((container as any)._leaflet_id) {
        delete (container as any)._leaflet_id
      }

      // Calculate bounds from GPS track or feature geometry
      let bounds: [[number, number], [number, number]] | null = null
      
      // Try GPS track first
      if (completion.gps_track && completion.gps_track.coordinates && Array.isArray(completion.gps_track.coordinates)) {
        for (const coord of completion.gps_track.coordinates) {
          // GeoJSON format is [lng, lat] or [lng, lat, elevation]
          const lng = Array.isArray(coord) ? coord[0] : null
          const lat = Array.isArray(coord) ? coord[1] : null
          if (lng !== null && lat !== null && !isNaN(lng) && !isNaN(lat)) {
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
      
      // Fallback to feature geometry
      if (!bounds && skiFeature?.geometry?.type === 'LineString' && skiFeature.geometry.coordinates) {
        for (const coord of skiFeature.geometry.coordinates) {
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
      
      if (!bounds) {
        bounds = [[39.5, -106.0], [39.6, -105.9]] // Default fallback
      }

      const center: [number, number] = [
        (bounds[0][0] + bounds[1][0]) / 2,
        (bounds[0][1] + bounds[1][1]) / 2
      ]

      const map = L.map(mapRef.current, {
        center,
        zoom: 15,
        zoomControl: true,
        attributionControl: false
      })

      // Add satellite tile layer
      L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        attribution: '© <a href="https://www.esri.com">Esri</a>, Maxar, Earthstar Geographics',
        maxZoom: 19
      }).addTo(map)

      // Draw GPS track if available
      if (completion.gps_track && completion.gps_track.coordinates && Array.isArray(completion.gps_track.coordinates) && completion.gps_track.coordinates.length >= 2) {
        const trackCoords = completion.gps_track.coordinates
          .filter(c => Array.isArray(c) && c.length >= 2)
          .map(c => [c[1], c[0]] as [number, number]) // Convert [lng, lat] to [lat, lng] for Leaflet
        if (trackCoords.length >= 2) {
          L.polyline(trackCoords, {
            color: '#3b82f6',
            weight: 4,
            opacity: 0.9,
            smoothFactor: 1
          }).addTo(map)
        }
      }

      // Draw feature geometry (run path) if available
      if (skiFeature?.geometry?.type === 'LineString' && skiFeature.geometry.coordinates) {
        const difficultyColors: Record<string, string> = {
          'green': '#22c55e',
          'blue': '#3b82f6',
          'black': '#1f2937',
          'double-black': '#1f2937',
          'terrain-park': '#f97316',
          'other': '#9ca3af'
        }
        
        const featureCoords = skiFeature.geometry.coordinates.map(c => [c[1], c[0]] as [number, number])
        L.polyline(featureCoords, {
          color: difficultyColors[skiFeature.difficulty || 'other'],
          weight: 3,
          opacity: 0.6,
          dashArray: '10, 5'
        }).addTo(map)
      }

      leafletMapRef.current = map
      setMapLoaded(true)

      // Invalidate size to ensure proper rendering after modal is visible
      setTimeout(() => {
        if (leafletMapRef.current) {
          leafletMapRef.current.invalidateSize()
          // Fit bounds after size is corrected
          try {
            leafletMapRef.current.fitBounds(bounds, { padding: [20, 20] })
          } catch (e) {
            console.warn('Error fitting bounds:', e)
          }
        }
      }, 200)
    }

    loadMap().catch((err) => {
      console.error('Error loading map:', err)
    })

    return () => {
      if (leafletMapRef.current) {
        try {
          leafletMapRef.current.remove()
        } catch (e) {
          console.warn('Error removing map:', e)
        }
        leafletMapRef.current = null
      }
      setMapLoaded(false)
    }
  }, [completion.gps_track, skiFeature])

  // Close on escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }
    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [onClose])

  // Prevent body scroll when modal is open
  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = ''
    }
  }, [])

  return (
    <div 
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/95 backdrop-blur-sm"
      onClick={onClose}
      style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0, 0, 0, 0.95)' }}
    >
      <div 
        className="bg-gradient-to-br from-gray-900 to-gray-800 rounded-2xl border border-white/10 shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col relative z-[10000]"
        onClick={(e) => e.stopPropagation()}
        style={{ position: 'relative', zIndex: 10000 }}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <DifficultyBadge difficulty={skiFeature?.difficulty} size="lg" />
            <div>
              <h2 className="text-xl font-bold text-white">
                {skiFeature?.name || 'Unknown Run'}
              </h2>
              <p className="text-sm text-gray-400">
                {formatDetectionMethod(completion.detection_method)}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-white/10 transition-colors"
            aria-label="Close"
          >
            <svg className="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content - Scrollable */}
        <div className="flex-1 overflow-y-auto">
          {/* Map - Always show if we have geometry data */}
          {(completion.gps_track || skiFeature?.geometry) && (
            <div className="relative h-64 bg-gray-900" style={{ minHeight: '256px', position: 'relative', zIndex: 1 }}>
              {!mapLoaded && (
                <div className="absolute inset-0 flex items-center justify-center bg-gray-900 z-10" style={{ zIndex: 10 }}>
                  <div className="text-gray-400 text-sm">Loading map...</div>
                </div>
              )}
              <div 
                ref={mapRef} 
                className="h-full w-full" 
                style={{ minHeight: '256px', position: 'relative', zIndex: 1, backgroundColor: '#1f2937' }}
                data-run-detail-map={completion.id}
              />
            </div>
          )}

          {/* Stats Grid */}
          <div className="p-6 grid grid-cols-2 gap-4">
            {/* Duration */}
            {completion.duration_seconds && (
              <div className="bg-white/5 rounded-lg p-4">
                <div className="text-sm text-gray-400 mb-1">Duration</div>
                <div className="text-2xl font-bold text-white">
                  {formatDuration(completion.duration_seconds)}
                </div>
              </div>
            )}

            {/* Top Speed */}
            {completion.top_speed_kmh && (
              <div className="bg-white/5 rounded-lg p-4">
                <div className="text-sm text-gray-400 mb-1">Top Speed</div>
                <div className="text-2xl font-bold text-white">
                  {completion.top_speed_kmh.toFixed(1)} km/h
                </div>
              </div>
            )}

            {/* Average Speed */}
            {completion.avg_speed_kmh && (
              <div className="bg-white/5 rounded-lg p-4">
                <div className="text-sm text-gray-400 mb-1">Average Speed</div>
                <div className="text-2xl font-bold text-white">
                  {completion.avg_speed_kmh.toFixed(1)} km/h
                </div>
              </div>
            )}

            {/* Detection Method */}
            <div className="bg-white/5 rounded-lg p-4">
              <div className="text-sm text-gray-400 mb-1">Detection Method</div>
              <div className="text-lg font-semibold text-white">
                {formatDetectionMethod(completion.detection_method)}
              </div>
            </div>
          </div>

          {/* Timestamps */}
          <div className="px-6 pb-6 space-y-3">
            <div className="bg-white/5 rounded-lg p-4">
              <div className="text-sm text-gray-400 mb-1">Started At</div>
              <div className="text-base font-medium text-white">
                {formatDateTime(completion.started_at)}
              </div>
            </div>
            <div className="bg-white/5 rounded-lg p-4">
              <div className="text-sm text-gray-400 mb-1">Completed At</div>
              <div className="text-base font-medium text-white">
                {formatDateTime(completion.completed_at)}
              </div>
            </div>
          </div>

          {/* Run Info */}
          {skiFeature && (
            <div className="px-6 pb-6 space-y-2">
              <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Run Information</h3>
              <div className="bg-white/5 rounded-lg p-4 space-y-2">
                {skiFeature.type && (
                  <div className="flex justify-between">
                    <span className="text-sm text-gray-400">Type</span>
                    <span className="text-sm font-medium text-white capitalize">{skiFeature.type}</span>
                  </div>
                )}
                {skiFeature.difficulty && (
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-gray-400">Difficulty</span>
                    <DifficultyBadge difficulty={skiFeature.difficulty} size="sm" />
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
