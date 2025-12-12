/**
 * Type definitions for Leaflet and related plugins
 * Used to replace `any` types in map components
 */

import type L from 'leaflet'

// Re-export Leaflet types
export type LeafletMap = L.Map
export type LeafletMarker = L.Marker
export type LeafletCircleMarker = L.CircleMarker
export type LeafletCircle = L.Circle
export type LeafletPolygon = L.Polygon
export type LeafletPolyline = L.Polyline
export type LeafletTileLayer = L.TileLayer
export type LeafletGeoJSON = L.GeoJSON
export type LeafletLayer = L.Layer
export type LeafletControl = L.Control

// Extended types for our usage
export interface LeafletWithEsri {
  esri?: {
    imageMapLayer: (options: EsriImageMapLayerOptions) => L.Layer
  }
}

export interface EsriImageMapLayerOptions {
  url: string
  attribution?: string
  opacity?: number
  renderingRule?: {
    rasterFunction: string
    rasterFunctionArguments: Record<string, unknown>
  }
}

// TextPath plugin types
export interface TextPathLayer extends L.Polyline {
  setText: (text: string, options?: TextPathOptions) => void
  removeText: () => void
}

export interface TextPathOptions {
  repeat?: boolean
  center?: boolean
  offset?: number
  attributes?: {
    fill?: string
    'font-weight'?: string
    'font-size'?: string
    'font-family'?: string
    stroke?: string
    'stroke-width'?: string
    'stroke-linejoin'?: string
    'stroke-linecap'?: string
    'paint-order'?: string
  }
}

// Map layer with accuracy circle (for user location)
export interface UserLocationMarker extends L.CircleMarker {
  accuracyCircle?: L.Circle
}

// Tile event types
export interface TileLoadEvent {
  tile: HTMLImageElement
}

// GeoJSON geometry types
export type GeoJSONGeometryType =
  | 'Point'
  | 'LineString'
  | 'Polygon'
  | 'MultiPoint'
  | 'MultiLineString'
  | 'MultiPolygon'
  | 'GeometryCollection'

export interface GeoJSONCoordinate {
  type: GeoJSONGeometryType
  coordinates: number[] | number[][] | number[][][] | number[][][][]
}

// Layer control reference
export interface LayerControlRef {
  current: L.Control.Layers | null
}

// Stored textpath layer info
export interface TextPathLayerInfo {
  layer: TextPathLayer
  text: string
  options: TextPathOptions
  color: string
}



