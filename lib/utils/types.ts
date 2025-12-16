// Database types

// GeoJSON types for geometry
export type GeoJSONPoint = {
  type: 'Point'
  coordinates: [number, number] | [number, number, number]
}

export type GeoJSONLineString = {
  type: 'LineString'
  coordinates: Array<[number, number] | [number, number, number]>
}

export type GeoJSONPolygon = {
  type: 'Polygon'
  coordinates: Array<Array<[number, number] | [number, number, number]>>
}

export type GeoJSONMultiLineString = {
  type: 'MultiLineString'
  coordinates: Array<Array<[number, number] | [number, number, number]>>
}

export type GeoJSONMultiPolygon = {
  type: 'MultiPolygon'
  coordinates: Array<Array<Array<[number, number] | [number, number, number]>>>
}

export type GeoJSONGeometry = 
  | GeoJSONPoint 
  | GeoJSONLineString 
  | GeoJSONPolygon 
  | GeoJSONMultiLineString 
  | GeoJSONMultiPolygon

// Metadata types for ski features
export interface SkiFeatureMetadata {
  original_properties?: Record<string, unknown>
  elevation_max?: number
  elevation_min?: number
  length_meters?: number
  source?: string
  [key: string]: unknown
}

export interface Resort {
  id: string
  name: string
  slug: string
  subdomain?: string | null
  theme_config?: {
    primaryColor?: string
    secondaryColor?: string
    fontFamily?: string
    logoUrl?: string
    faviconUrl?: string
  } | null
  map_config?: {
    center?: [number, number]
    zoom?: number
    customTiles?: string
  } | null
  created_at: string
}

export interface Sign {
  id: string
  resort_id: string
  name: string
  description?: string | null
  hint?: string | null
  qr_code: string
  lat: number
  lng: number
  difficulty?: string | null
  photo_url?: string | null
  order_index?: number | null
  active: boolean
  created_at: string
}

export interface UserDiscovery {
  id: string
  user_id: string
  sign_id: string
  discovered_at: string
  gps_lat?: number | null
  gps_lng?: number | null
  qr_verified: boolean
}

export interface UserMetadata {
  id: string
  resort_id?: string | null
  pass_number?: string | null
  display_name?: string | null
  is_admin?: boolean
  created_at: string
}

export interface Prize {
  id: string
  resort_id: string
  title: string
  description?: string | null
  requirement?: string | null
  active: boolean
  created_at: string
}

export interface SkiFeature {
  id: string
  resort_id: string
  name: string
  type: 'trail' | 'lift' | 'boundary' | 'area' | 'road'
  difficulty?: 'green' | 'blue' | 'black' | 'double-black' | 'terrain-park' | 'other' | null
  geometry: GeoJSONGeometry
  metadata?: SkiFeatureMetadata | null
  status?: 'open' | 'closed' | 'groomed' | 'ungroomed' | null
  active: boolean
  order_index?: number | null
  created_at: string
}

// Run tracking types
export interface SkiSession {
  id: string
  user_id: string
  resort_id: string
  session_date: string
  started_at: string
  ended_at?: string | null
  total_runs: number
  total_vertical_meters: number
  total_distance_meters: number
  top_speed_kmh: number
  avg_speed_kmh: number
  is_active: boolean
}

export interface RunCompletion {
  id: string
  session_id: string
  user_id: string
  ski_feature_id: string | null // Nullable for off-trail segments
  started_at: string
  completed_at: string
  duration_seconds?: number | null
  top_speed_kmh?: number | null
  avg_speed_kmh?: number | null
  gps_track?: GeoJSONLineString | null
  detection_method: 'gps_proximity' | 'manual' | 'qr_scan' | 'retroactive_detection'
  // Descent session fields
  descent_session_id?: string | null
  segment_type?: 'on_trail' | 'off_trail'
  sequence_order?: number | null
  associated_run_id?: string | null
  completion_percentage?: number | null // Percentage of run completed (0-100)
  // Joined data
  ski_feature?: SkiFeature
}

export interface DescentSession {
  id: string
  session_id: string
  user_id: string
  started_at: string
  ended_at?: string | null
  total_segments: number
  total_distance_meters: number
  total_vertical_meters: number
  top_speed_kmh: number
  avg_speed_kmh: number
  is_active: boolean
  // Joined data
  segments?: RunCompletion[]
}

export interface OffTrailSegment {
  featureId: string | null // null for off-trail
  featureName: string // e.g., "Off-trail (from Run Name)"
  featureType: string
  startTime: Date
  locationHistory: Array<{
    lat: number
    lng: number
    altitude?: number
    speed?: number
    timestamp: Date
  }>
  topSpeed: number
  associatedRunId: string // The run they left
  associatedRunName: string
  isCompleted: boolean
  completedAt?: Date
}

export interface LocationHistory {
  id: string
  session_id: string
  user_id: string
  latitude: number
  longitude: number
  altitude_meters?: number | null
  speed_kmh?: number | null
  accuracy_meters?: number | null
  recorded_at: string
}

// Session with aggregated data for display
export interface SessionSummary extends SkiSession {
  resort?: Resort
  run_completions?: RunCompletion[]
  unique_runs_count?: number
  descent_sessions?: DescentSession[]
}
