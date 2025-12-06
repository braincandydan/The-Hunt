'use client'

import { useState, useRef, useEffect } from 'react'

interface ElevationPoint {
  distance: number // Cumulative distance in meters
  elevation: number // Elevation in meters
  lat: number
  lng: number
}

interface ElevationProfileProps {
  geometry: any // GeoJSON geometry
  width?: number
  height?: number
  onHover?: (point: ElevationPoint | null) => void
}

export default function ElevationProfile({ 
  geometry, 
  width = 300, 
  height = 120,
  onHover 
}: ElevationProfileProps) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)

  // Extract elevation profile from geometry
  const extractElevationProfile = (): ElevationPoint[] => {
    const points: ElevationPoint[] = []
    let cumulativeDistance = 0
    let lastPoint: [number, number, number?] | null = null

    const processCoordinates = (coords: any[]): void => {
      if (!Array.isArray(coords)) return

      // Check if this is a coordinate array [lng, lat] or [lng, lat, elevation]
      if (coords.length >= 2 && typeof coords[0] === 'number' && typeof coords[1] === 'number') {
        const lng = coords[0]
        const lat = coords[1]
        const elevation = coords.length >= 3 && typeof coords[2] === 'number' ? coords[2] : null

        if (lastPoint) {
          // Calculate distance from last point
          const distance = calculateDistance(
            lastPoint[1], // lat
            lastPoint[0], // lng
            lat,
            lng
          )
          cumulativeDistance += distance
        }

        // If we have elevation, use it; otherwise try to estimate or skip
        if (elevation !== null && elevation !== undefined) {
          points.push({
            distance: cumulativeDistance,
            elevation,
            lat,
            lng,
          })
        }

        lastPoint = [lng, lat, elevation || undefined]
      } else {
        // Recursively process nested arrays
        coords.forEach(processCoordinates)
      }
    }

    // Handle different geometry types
    if (geometry.type === 'LineString') {
      processCoordinates(geometry.coordinates)
    } else if (geometry.type === 'MultiLineString') {
      geometry.coordinates.forEach((line: any[]) => {
        processCoordinates(line)
      })
    }

    return points
  }

  // Calculate distance between two lat/lng points in meters
  const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
    const R = 6371000 // Earth radius in meters
    const dLat = (lat2 - lat1) * Math.PI / 180
    const dLon = (lon2 - lon1) * Math.PI / 180
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) *
        Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2)
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
    return R * c
  }

  const profile = extractElevationProfile()

  // If no elevation data, return null
  if (profile.length === 0) {
    return null
  }

  // Calculate chart dimensions and padding
  const padding = { top: 20, right: 20, bottom: 30, left: 50 }
  const chartWidth = width - padding.left - padding.right
  const chartHeight = height - padding.top - padding.bottom

  // Find min/max for scaling
  const distances = profile.map(p => p.distance)
  const elevations = profile.map(p => p.elevation)
  const minDistance = Math.min(...distances)
  const maxDistance = Math.max(...distances)
  const minElevation = Math.min(...elevations)
  const maxElevation = Math.max(...elevations)
  const elevationRange = maxElevation - minElevation || 1

  // Scale functions
  const scaleX = (distance: number) => {
    return ((distance - minDistance) / (maxDistance - minDistance || 1)) * chartWidth
  }

  const scaleY = (elevation: number) => {
    return chartHeight - ((elevation - minElevation) / elevationRange) * chartHeight
  }

  // Generate path for elevation line
  const pathData = profile
    .map((point, i) => {
      const x = scaleX(point.distance) + padding.left
      const y = scaleY(point.elevation) + padding.top
      return `${i === 0 ? 'M' : 'L'} ${x} ${y}`
    })
    .join(' ')

  // Handle mouse move
  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!svgRef.current) return

    const rect = svgRef.current.getBoundingClientRect()
    const x = e.clientX - rect.left - padding.left
    const y = e.clientY - rect.top - padding.top

    // Find closest point
    let closestIndex = 0
    let minDist = Infinity

    profile.forEach((point, i) => {
      const pointX = scaleX(point.distance)
      const dist = Math.abs(pointX - x)
      if (dist < minDist) {
        minDist = dist
        closestIndex = i
      }
    })

    setHoveredIndex(closestIndex)
    
    if (onHover && closestIndex < profile.length) {
      onHover(profile[closestIndex])
    }
  }

  const handleMouseLeave = () => {
    setHoveredIndex(null)
    if (onHover) {
      onHover(null)
    }
  }

  const hoveredPoint = hoveredIndex !== null ? profile[hoveredIndex] : null

  return (
    <div className="mt-3">
      <div className="text-xs text-gray-600 mb-1 font-medium">Elevation Profile</div>
      <svg
        ref={svgRef}
        width={width}
        height={height}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        className="border border-gray-200 rounded"
        style={{ cursor: 'crosshair' }}
      >
        {/* Grid lines */}
        {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
          const y = padding.top + ratio * chartHeight
          return (
            <line
              key={`grid-h-${ratio}`}
              x1={padding.left}
              y1={y}
              x2={width - padding.right}
              y2={y}
              stroke="#e5e7eb"
              strokeWidth={0.5}
            />
          )
        })}

        {/* Y-axis labels (elevation) */}
        {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
          const elevation = minElevation + (1 - ratio) * elevationRange
          const y = padding.top + ratio * chartHeight
          return (
            <g key={`label-y-${ratio}`}>
              <text
                x={padding.left - 5}
                y={y + 4}
                textAnchor="end"
                fontSize="10"
                fill="#6b7280"
              >
                {Math.round(elevation)}m
              </text>
            </g>
          )
        })}

        {/* X-axis label (distance) */}
        <text
          x={width / 2}
          y={height - 5}
          textAnchor="middle"
          fontSize="10"
          fill="#6b7280"
        >
          Distance: {Math.round(maxDistance)}m
        </text>

        {/* Elevation path */}
        <path
          d={pathData}
          fill="none"
          stroke="#3b82f6"
          strokeWidth={2}
        />

        {/* Fill area under curve */}
        <path
          d={`${pathData} L ${width - padding.right} ${padding.top + chartHeight} L ${padding.left} ${padding.top + chartHeight} Z`}
          fill="url(#gradient)"
          opacity={0.3}
        />

        {/* Gradient definition */}
        <defs>
          <linearGradient id="gradient" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.4} />
            <stop offset="100%" stopColor="#3b82f6" stopOpacity={0.1} />
          </linearGradient>
        </defs>

        {/* Hover indicator line */}
        {hoveredPoint && (
          <>
            <line
              x1={scaleX(hoveredPoint.distance) + padding.left}
              y1={padding.top}
              x2={scaleX(hoveredPoint.distance) + padding.left}
              y2={padding.top + chartHeight}
              stroke="#ef4444"
              strokeWidth={1.5}
              strokeDasharray="4,4"
            />
            <circle
              cx={scaleX(hoveredPoint.distance) + padding.left}
              cy={scaleY(hoveredPoint.elevation) + padding.top}
              r={4}
              fill="#ef4444"
              stroke="white"
              strokeWidth={2}
            />
            {/* Tooltip */}
            <g>
              <rect
                x={scaleX(hoveredPoint.distance) + padding.left - 40}
                y={scaleY(hoveredPoint.elevation) + padding.top - 35}
                width={80}
                height={30}
                fill="rgba(0, 0, 0, 0.8)"
                rx={4}
              />
              <text
                x={scaleX(hoveredPoint.distance) + padding.left}
                y={scaleY(hoveredPoint.elevation) + padding.top - 20}
                textAnchor="middle"
                fontSize="10"
                fill="white"
                fontWeight="bold"
              >
                {Math.round(hoveredPoint.elevation)}m
              </text>
              <text
                x={scaleX(hoveredPoint.distance) + padding.left}
                y={scaleY(hoveredPoint.elevation) + padding.top - 8}
                textAnchor="middle"
                fontSize="9"
                fill="#d1d5db"
              >
                {Math.round(hoveredPoint.distance)}m
              </text>
            </g>
          </>
        )}
      </svg>
    </div>
  )
}

