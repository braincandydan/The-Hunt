/**
 * Map-related constants
 * Centralized location for magic numbers and configuration values
 */

// Zoom levels
export const MAP_ZOOM = {
  MIN_FOR_LABELS: 15,  // Minimum zoom level to show trail labels
  DEFAULT: 13,         // Default initial zoom
  CLOSE: 16,           // Close-up zoom for single sign view
  MAX: 19,             // Maximum zoom level
  MIN: 10,             // Minimum zoom level
} as const

// Speed conversion
export const SPEED = {
  MS_TO_KMH: 3.6,      // Multiply m/s by this to get km/h
  HISTORY_SIZE: 100,   // Number of speed readings to keep for averaging
} as const

// Location tracking
export const LOCATION = {
  TIMEOUT_MS: 10000,    // GPS timeout in milliseconds
  HIGH_ACCURACY: true,  // Use high accuracy GPS
  MAX_AGE_MS: 0,        // Don't use cached positions
} as const

// Distance thresholds (in kilometers)
export const DISTANCE = {
  FAR_FROM_SIGN: 0.1,   // 100 meters - warn if user is this far from sign
} as const

// UI constants
export const UI = {
  Z_INDEX: {
    MAP_OVERLAY: 1001,
    BOTTOM_SHEET: 1003,
    BACKDROP: 1002,
    MODAL: 1004,
  },
  ANIMATION_DURATION_MS: 300,
} as const

// Map bounds expansion (percentage to expand beyond boundary)
export const BOUNDS_EXPANSION = 0.2  // 20% expansion

// Default coordinates (used when no resort data available)
export const DEFAULT_COORDINATES = {
  LAT: 49.73283,   // Example ski resort
  LNG: -118.9412,
} as const



