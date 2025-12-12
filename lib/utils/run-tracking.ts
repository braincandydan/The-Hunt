import { SkiFeature, GeoJSONLineString, GeoJSONMultiLineString } from './types'

/**
 * Calculates the distance in meters between two GPS coordinates using Haversine formula
 */
export function haversineDistance(
  lat1: number, lon1: number,
  lat2: number, lon2: number
): number {
  const R = 6371000 // Earth's radius in meters
  const φ1 = lat1 * Math.PI / 180
  const φ2 = lat2 * Math.PI / 180
  const Δφ = (lat2 - lat1) * Math.PI / 180
  const Δλ = (lon2 - lon1) * Math.PI / 180

  const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
            Math.cos(φ1) * Math.cos(φ2) *
            Math.sin(Δλ/2) * Math.sin(Δλ/2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))

  return R * c
}

/**
 * Gets all coordinates from a ski feature's geometry
 */
export function getFeatureCoordinates(feature: SkiFeature): [number, number][] {
  const geometry = feature.geometry
  
  if (geometry.type === 'LineString') {
    return (geometry as GeoJSONLineString).coordinates.map(c => [c[0], c[1]])
  } else if (geometry.type === 'MultiLineString') {
    return (geometry as GeoJSONMultiLineString).coordinates.flat().map(c => [c[0], c[1]])
  }
  
  return []
}

/**
 * Finds the closest point on a run to the user's location
 * Returns distance in meters and the segment index
 */
export function findClosestPointOnRun(
  userLat: number,
  userLng: number,
  feature: SkiFeature
): { distance: number; segmentIndex: number; progress: number } | null {
  const coords = getFeatureCoordinates(feature)
  if (coords.length === 0) return null
  
  let minDistance = Infinity
  let closestSegment = 0
  let closestProgress = 0
  
  for (let i = 0; i < coords.length - 1; i++) {
    const [lng1, lat1] = coords[i]
    const [lng2, lat2] = coords[i + 1]
    
    // Find closest point on segment
    const segmentLength = haversineDistance(lat1, lng1, lat2, lng2)
    if (segmentLength === 0) continue
    
    // Project user position onto segment
    const dx = lng2 - lng1
    const dy = lat2 - lat1
    const t = Math.max(0, Math.min(1,
      ((userLng - lng1) * dx + (userLat - lat1) * dy) / (dx * dx + dy * dy)
    ))
    
    const closestLng = lng1 + t * dx
    const closestLat = lat1 + t * dy
    const distance = haversineDistance(userLat, userLng, closestLat, closestLng)
    
    if (distance < minDistance) {
      minDistance = distance
      closestSegment = i
      closestProgress = (i + t) / (coords.length - 1)
    }
  }
  
  return {
    distance: minDistance,
    segmentIndex: closestSegment,
    progress: closestProgress
  }
}

/**
 * Determines if the user is currently on a run (within threshold distance)
 */
export function isUserOnRun(
  userLat: number,
  userLng: number,
  feature: SkiFeature,
  thresholdMeters: number = 30 // Default 30m proximity
): boolean {
  const result = findClosestPointOnRun(userLat, userLng, feature)
  if (!result) return false
  return result.distance <= thresholdMeters
}

/**
 * Tracks the state of a user's progress on a single run
 */
export interface RunProgress {
  featureId: string
  featureName: string
  featureType: string
  difficulty?: string
  startTime: Date
  startProgress: number // 0-1, position along the run when started
  currentProgress: number // 0-1, current position along the run
  maxProgress: number // Highest progress reached
  locationHistory: Array<{
    lat: number
    lng: number
    altitude?: number
    speed?: number
    timestamp: Date
  }>
  topSpeed: number
  isCompleted: boolean
  completedAt?: Date
}

/**
 * Run Tracker class - manages tracking state for multiple runs
 */
export class RunTracker {
  private activeRuns: Map<string, RunProgress> = new Map()
  private completedRuns: RunProgress[] = []
  private features: SkiFeature[] = []
  private proximityThreshold: number = 30 // meters
  private completionThreshold: number = 0.85 // 85% of run to count as complete
  private lastLocation: { lat: number; lng: number; timestamp: Date } | null = null
  
  constructor(features: SkiFeature[], options?: {
    proximityThreshold?: number
    completionThreshold?: number
  }) {
    // Only track trails (not lifts, boundaries, etc.)
    this.features = features.filter(f => f.type === 'trail')
    if (options?.proximityThreshold) this.proximityThreshold = options.proximityThreshold
    if (options?.completionThreshold) this.completionThreshold = options.completionThreshold
  }
  
  /**
   * Update with new location - returns newly completed runs
   */
  updateLocation(
    lat: number,
    lng: number,
    altitude?: number,
    speed?: number
  ): RunProgress[] {
    const timestamp = new Date()
    const newlyCompleted: RunProgress[] = []
    
    // Check each trail for proximity
    for (const feature of this.features) {
      const result = findClosestPointOnRun(lat, lng, feature)
      if (!result) continue
      
      const isOnRun = result.distance <= this.proximityThreshold
      const existingRun = this.activeRuns.get(feature.id)
      
      if (isOnRun) {
        if (existingRun) {
          // Update existing run progress
          existingRun.currentProgress = result.progress
          existingRun.maxProgress = Math.max(existingRun.maxProgress, result.progress)
          existingRun.locationHistory.push({
            lat, lng, altitude, speed, timestamp
          })
          if (speed && speed > existingRun.topSpeed) {
            existingRun.topSpeed = speed
            if (process.env.NODE_ENV === 'development') {
              console.log(`[RUN TRACKING] New top speed for ${existingRun.featureName}: ${speed.toFixed(1)} km/h`)
            }
          }
          
          // Check if run is now complete (traveled most of the run)
          const progressTraveled = existingRun.maxProgress - existingRun.startProgress
          if (!existingRun.isCompleted && progressTraveled >= this.completionThreshold) {
            existingRun.isCompleted = true
            existingRun.completedAt = timestamp
            newlyCompleted.push({ ...existingRun })
            this.completedRuns.push({ ...existingRun })
          }
        } else {
          // Start tracking new run
          this.activeRuns.set(feature.id, {
            featureId: feature.id,
            featureName: feature.name,
            featureType: feature.type,
            difficulty: feature.difficulty || undefined,
            startTime: timestamp,
            startProgress: result.progress,
            currentProgress: result.progress,
            maxProgress: result.progress,
            locationHistory: [{ lat, lng, altitude, speed, timestamp }],
            topSpeed: speed || 0,
            isCompleted: false
          })
        }
      } else if (existingRun && !existingRun.isCompleted) {
        // User has left the run without completing - check if they did enough
        const progressTraveled = existingRun.maxProgress - existingRun.startProgress
        if (progressTraveled >= this.completionThreshold) {
          existingRun.isCompleted = true
          existingRun.completedAt = timestamp
          newlyCompleted.push({ ...existingRun })
          this.completedRuns.push({ ...existingRun })
        }
        // Remove from active tracking (either completed or abandoned)
        this.activeRuns.delete(feature.id)
      }
    }
    
    this.lastLocation = { lat, lng, timestamp }
    return newlyCompleted
  }
  
  /**
   * Get currently active (in-progress) runs
   */
  getActiveRuns(): RunProgress[] {
    return Array.from(this.activeRuns.values())
  }
  
  /**
   * Get all completed runs
   */
  getCompletedRuns(): RunProgress[] {
    return [...this.completedRuns]
  }
  
  /**
   * Get count of unique runs completed
   */
  getUniqueRunsCompleted(): number {
    const uniqueIds = new Set(this.completedRuns.map(r => r.featureId))
    return uniqueIds.size
  }
  
  /**
   * Get total runs completed (including repeats)
   */
  getTotalRunsCompleted(): number {
    return this.completedRuns.length
  }
  
  /**
   * Get top speed across all runs
   */
  getTopSpeed(): number {
    let topSpeed = 0
    for (const run of this.completedRuns) {
      if (run.topSpeed > topSpeed) topSpeed = run.topSpeed
    }
    for (const run of this.activeRuns.values()) {
      if (run.topSpeed > topSpeed) topSpeed = run.topSpeed
    }
    return topSpeed
  }
  
  /**
   * Manually mark a run as completed (e.g., from QR scan)
   */
  markRunCompleted(featureId: string, method: 'qr_scan' | 'manual' = 'manual'): boolean {
    const feature = this.features.find(f => f.id === featureId)
    if (!feature) return false
    
    // Check if already completed recently
    const recentlyCompleted = this.completedRuns.some(r => 
      r.featureId === featureId && 
      (new Date().getTime() - (r.completedAt?.getTime() || 0)) < 5 * 60 * 1000 // 5 min window
    )
    if (recentlyCompleted) return false
    
    const timestamp = new Date()
    const completion: RunProgress = {
      featureId: feature.id,
      featureName: feature.name,
      featureType: feature.type,
      difficulty: feature.difficulty || undefined,
      startTime: timestamp,
      startProgress: 0,
      currentProgress: 1,
      maxProgress: 1,
      locationHistory: this.lastLocation ? [{
        lat: this.lastLocation.lat,
        lng: this.lastLocation.lng,
        timestamp: this.lastLocation.timestamp
      }] : [],
      topSpeed: 0,
      isCompleted: true,
      completedAt: timestamp
    }
    
    this.completedRuns.push(completion)
    
    // Remove from active if it was being tracked
    this.activeRuns.delete(featureId)
    
    return true
  }
  
  /**
   * Reset tracker (e.g., for new session)
   */
  reset(): void {
    this.activeRuns.clear()
    this.completedRuns = []
    this.lastLocation = null
  }
}

/**
 * Convert completed run to database format for saving
 */
export function runProgressToDbFormat(
  run: RunProgress,
  sessionId: string,
  userId: string
): {
  session_id: string
  user_id: string
  ski_feature_id: string
  started_at: string
  completed_at: string
  duration_seconds: number
  top_speed_kmh: number | null
  avg_speed_kmh: number | null
  gps_track: object | null
  detection_method: string
} {
  const startTime = run.startTime.toISOString()
  const endTime = (run.completedAt || new Date()).toISOString()
  const durationMs = (run.completedAt?.getTime() || Date.now()) - run.startTime.getTime()
  const durationSeconds = Math.round(durationMs / 1000)
  
  // Calculate average speed from location history
  let avgSpeed: number | null = null
  if (run.locationHistory.length > 0) {
    const speeds = run.locationHistory
      .map(l => l.speed)
      .filter((s): s is number => s !== undefined && s !== null)
    if (speeds.length > 0) {
      avgSpeed = speeds.reduce((a, b) => a + b, 0) / speeds.length
    }
  }
  
  // Build GPS track GeoJSON
  let gpsTrack: object | null = null
  if (run.locationHistory.length >= 2) {
    gpsTrack = {
      type: 'LineString',
      coordinates: run.locationHistory.map(l => [l.lng, l.lat, l.altitude].filter(v => v !== undefined))
    }
  }
  
  return {
    session_id: sessionId,
    user_id: userId,
    ski_feature_id: run.featureId,
    started_at: startTime,
    completed_at: endTime,
    duration_seconds: durationSeconds,
    top_speed_kmh: run.topSpeed > 0 ? run.topSpeed : null,
    avg_speed_kmh: avgSpeed,
    gps_track: gpsTrack,
    detection_method: 'gps_proximity'
  }
}



