/**
 * Custom Tile Layer Component for QGIS-generated tiles
 * 
 * This component provides a reusable way to add custom QGIS-generated
 * tile layers to your Leaflet map.
 * 
 * Usage:
 *   <CustomTileLayer
 *     baseUrl="/tiles"
 *     bounds={resortBounds}
 *     attribution="Custom QGIS Map"
 *   />
 */

'use client'

import { useEffect, useRef } from 'react'

interface CustomTileLayerProps {
  baseUrl: string // e.g., "/tiles" or "https://cdn.example.com/tiles"
  bounds?: any // Leaflet LatLngBounds
  attribution?: string
  minZoom?: number
  maxZoom?: number
  opacity?: number
  zIndex?: number
  onLoad?: (layer: any) => void
}

export default function CustomTileLayer({
  baseUrl,
  bounds,
  attribution = 'Custom QGIS Map',
  minZoom = 10,
  maxZoom = 18,
  opacity = 1.0,
  zIndex = 0,
  onLoad,
}: CustomTileLayerProps) {
  const layerRef = useRef<any>(null)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const L = (window as any).L
    if (!L) return

    // Create tile layer
    const tileLayer = L.tileLayer(`${baseUrl}/{z}/{x}/{y}.png`, {
      attribution,
      minZoom,
      maxZoom,
      opacity,
      zIndex,
      bounds, // Restrict tiles to bounds if provided
      // Add error handling for missing tiles
      errorTileUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', // 1x1 transparent PNG
    })

    layerRef.current = tileLayer

    if (onLoad) {
      onLoad(tileLayer)
    }

    return () => {
      if (layerRef.current) {
        layerRef.current.remove()
        layerRef.current = null
      }
    }
  }, [baseUrl, bounds, attribution, minZoom, maxZoom, opacity, zIndex, onLoad])

  return null // This component doesn't render anything
}

