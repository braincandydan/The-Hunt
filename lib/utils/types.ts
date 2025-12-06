// Database types
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
  geometry: any // GeoJSON geometry
  metadata?: any | null
  status?: 'open' | 'closed' | 'groomed' | 'ungroomed' | null
  active: boolean
  order_index?: number | null
  created_at: string
}
