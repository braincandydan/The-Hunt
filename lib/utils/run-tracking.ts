import { SkiFeature, GeoJSONLineString, GeoJSONMultiLineString, OffTrailSegment } from './types'

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
  private partialRuns: RunProgress[] = [] // Tracks partial runs that ended without meeting completion threshold
  private features: SkiFeature[] = []
  private proximityThreshold: number = 30 // meters
  private completionThreshold: number = 0.85 // 85% of run to count as complete
  private lastLocation: { lat: number; lng: number; timestamp: Date } | null = null
  
  // Grace period tracking
  private gracePeriodState: {
    isActive: boolean
    startTime: Date | null
    associatedRunId: string | null
    associatedRunName: string | null
    locationHistory: Array<{
      lat: number
      lng: number
      altitude?: number
      speed?: number
      timestamp: Date
    }>
    topSpeed: number
  } = {
    isActive: false,
    startTime: null,
    associatedRunId: null,
    associatedRunName: null,
    locationHistory: [],
    topSpeed: 0
  }
  
  private gracePeriodDuration: number = 30000 // 30 seconds in milliseconds
  
  // Descent session tracking
  private currentDescentSessionId: string | null = null
  private descentSequenceOrder: number = 0
  private isDescentActive: boolean = false
  private lastAltitude: number | null = null
  private lastSpeed: number | null = null
  private lowSpeedStartTime: Date | null = null
  private readonly DESCENT_SPEED_THRESHOLD = 5 // km/h - minimum speed to be considered moving
  private readonly DESCENT_STOP_DURATION = 10000 // 10 seconds of low/no speed to end descent
  
  private allFeatures: SkiFeature[] = [] // Store all features including lifts
  private liftFeatures: SkiFeature[] = [] // Store only lift features for checking
  
  constructor(features: SkiFeature[], options?: {
    proximityThreshold?: number
    completionThreshold?: number
    gracePeriodDuration?: number // milliseconds
  }) {
    // Store all features for lift checking
    this.allFeatures = features
    // Only track trails (not lifts, boundaries, etc.) for run tracking
    this.features = features.filter(f => f.type === 'trail')
    // Store lift features separately for descent detection
    this.liftFeatures = features.filter(f => f.type === 'lift')
    if (options?.proximityThreshold) this.proximityThreshold = options.proximityThreshold
    if (options?.completionThreshold) this.completionThreshold = options.completionThreshold
    if (options?.gracePeriodDuration) this.gracePeriodDuration = options.gracePeriodDuration
  }
  
  /**
   * Update with new location - returns newly completed runs, partial runs, and off-trail segments
   */
  updateLocation(
    lat: number,
    lng: number,
    altitude?: number,
    speed?: number
  ): { completedRuns: RunProgress[]; partialRuns: RunProgress[]; completedOffTrailSegment: OffTrailSegment | null } {
    const timestamp = new Date()
    const newlyCompleted: RunProgress[] = []
    const newlyPartial: RunProgress[] = []
    let completedOffTrailSegment: OffTrailSegment | null = null
    
    // Check if we're in grace period and if it has expired
    if (this.gracePeriodState.isActive && this.gracePeriodState.startTime) {
      const gracePeriodElapsed = timestamp.getTime() - this.gracePeriodState.startTime.getTime()
      if (gracePeriodElapsed >= this.gracePeriodDuration) {
        // Grace period expired - save off-trail segment
        if (this.gracePeriodState.locationHistory.length > 0) {
          completedOffTrailSegment = {
            featureId: null,
            featureName: `Off-trail (from ${this.gracePeriodState.associatedRunName || 'Unknown'})`,
            featureType: 'off_trail',
            startTime: this.gracePeriodState.startTime,
            locationHistory: [...this.gracePeriodState.locationHistory],
            topSpeed: this.gracePeriodState.topSpeed,
            associatedRunId: this.gracePeriodState.associatedRunId || '',
            associatedRunName: this.gracePeriodState.associatedRunName || 'Unknown',
            isCompleted: true,
            completedAt: timestamp
          }
        }
        // Reset grace period
        this.gracePeriodState = {
          isActive: false,
          startTime: null,
          associatedRunId: null,
          associatedRunName: null,
          locationHistory: [],
          topSpeed: 0
        }
      }
    }
    
    // Find closest trail and check proximity
    let closestTrail: { feature: SkiFeature; result: { distance: number; progress: number } } | null = null
    let minDistance = Infinity
    
    for (const feature of this.features) {
      const result = findClosestPointOnRun(lat, lng, feature)
      if (!result) continue
      
      if (result.distance < minDistance) {
        minDistance = result.distance
        closestTrail = { feature, result }
      }
    }
    
    const isOnAnyTrail = closestTrail && closestTrail.result.distance <= this.proximityThreshold
    
    // If we hit a trail during grace period, end grace period early and start new run
    if (this.gracePeriodState.isActive && isOnAnyTrail && closestTrail) {
      // End grace period - user hit another trail
      this.gracePeriodState.isActive = false
      this.gracePeriodState.startTime = null
      this.gracePeriodState.locationHistory = []
      this.gracePeriodState.topSpeed = 0
    }
    
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
        } else if (progressTraveled > 0 && existingRun.locationHistory.length >= 2) {
          // Save partial run segment (even if < completion threshold)
          // Only save if there's meaningful progress and at least 2 location points
          existingRun.completedAt = timestamp
          newlyPartial.push({ ...existingRun })
          this.partialRuns.push({ ...existingRun })
        }
        
        // Start grace period if run was active
        if (existingRun.locationHistory.length > 0) {
          this.gracePeriodState = {
            isActive: true,
            startTime: timestamp,
            associatedRunId: existingRun.featureId,
            associatedRunName: existingRun.featureName,
            locationHistory: [{
              lat, lng, altitude, speed, timestamp
            }],
            topSpeed: speed || 0
          }
        }
        
        // Remove from active tracking (either completed or in grace period)
        this.activeRuns.delete(feature.id)
      }
    }
    
    // If in grace period and not on any trail, continue tracking
    if (this.gracePeriodState.isActive && !isOnAnyTrail) {
      this.gracePeriodState.locationHistory.push({
        lat, lng, altitude, speed, timestamp
      })
      if (speed && speed > this.gracePeriodState.topSpeed) {
        this.gracePeriodState.topSpeed = speed
      }
    }
    
    // Update altitude and speed for descent detection
    if (altitude !== undefined) this.lastAltitude = altitude
    if (speed !== undefined) this.lastSpeed = speed
    
    this.lastLocation = { lat, lng, timestamp }
    return { completedRuns: newlyCompleted, partialRuns: newlyPartial, completedOffTrailSegment }
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
   * Get all partial runs (ended without meeting completion threshold)
   */
  getPartialRuns(): RunProgress[] {
    return [...this.partialRuns]
  }
  
  /**
   * Get all run segments (completed + partial)
   */
  getAllRunSegments(): RunProgress[] {
    return [...this.completedRuns, ...this.partialRuns]
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
   * Get current grace period state
   */
  getGracePeriodState(): {
    isActive: boolean
    elapsedMs: number
    associatedRunId: string | null
    associatedRunName: string | null
  } {
    if (!this.gracePeriodState.isActive || !this.gracePeriodState.startTime) {
      return {
        isActive: false,
        elapsedMs: 0,
        associatedRunId: null,
        associatedRunName: null
      }
    }
    
    return {
      isActive: true,
      elapsedMs: Date.now() - this.gracePeriodState.startTime.getTime(),
      associatedRunId: this.gracePeriodState.associatedRunId,
      associatedRunName: this.gracePeriodState.associatedRunName
    }
  }
  
  /**
   * Check if user is near or on a lift
   */
  isNearLift(lat: number, lng: number): boolean {
    for (const lift of this.liftFeatures) {
      const result = findClosestPointOnRun(lat, lng, lift)
      if (result && result.distance <= this.proximityThreshold * 2) { // Use 2x threshold for lifts (60m)
        return true
      }
    }
    return false
  }
  
  /**
   * Check if user is ascending (gaining altitude)
   */
  isAscending(altitude?: number): boolean {
    if (altitude === undefined || this.lastAltitude === null) return false
    // If altitude is increasing, user is ascending
    return altitude > this.lastAltitude
  }
  
  /**
   * Check if user is descending (moving down the mountain)
   * Returns false if user is on a lift or ascending
   */
  isDescending(lat: number, lng: number, altitude?: number, speed?: number): boolean {
    if (altitude === undefined || speed === undefined) return false
    
    // Don't create descent if user is near/on a lift
    if (this.isNearLift(lat, lng)) {
      return false
    }
    
    // Don't create descent if user is ascending (gaining altitude)
    if (this.isAscending(altitude)) {
      return false
    }
    
    // Must be moving at reasonable speed
    if (speed < this.DESCENT_SPEED_THRESHOLD) return false
    
    // Must be descending (altitude decreasing)
    if (this.lastAltitude !== null && altitude >= this.lastAltitude) {
      return false
    }
    
    return true
  }
  
  /**
   * Check if descent should end (user stopped moving)
   */
  shouldEndDescent(speed?: number): boolean {
    if (speed === undefined) return false
    
    const now = new Date()
    
    if (speed < this.DESCENT_SPEED_THRESHOLD) {
      if (!this.lowSpeedStartTime) {
        this.lowSpeedStartTime = now
      } else {
        const lowSpeedDuration = now.getTime() - this.lowSpeedStartTime.getTime()
        if (lowSpeedDuration >= this.DESCENT_STOP_DURATION) {
          return true
        }
      }
    } else {
      // Reset low speed timer if speed picks up
      this.lowSpeedStartTime = null
    }
    
    return false
  }
  
  /**
   * Get current descent session info
   */
  getDescentSessionInfo(): {
    descentSessionId: string | null
    sequenceOrder: number
    isActive: boolean
  } {
    return {
      descentSessionId: this.currentDescentSessionId,
      sequenceOrder: this.descentSequenceOrder,
      isActive: this.isDescentActive
    }
  }
  
  /**
   * Set descent session ID
   */
  setDescentSessionId(descentSessionId: string | null): void {
    this.currentDescentSessionId = descentSessionId
    if (descentSessionId) {
      this.isDescentActive = true
      this.descentSequenceOrder = 0
    } else {
      this.isDescentActive = false
      this.descentSequenceOrder = 0
    }
  }
  
  /**
   * Increment sequence order for next segment
   */
  incrementSequenceOrder(): number {
    this.descentSequenceOrder++
    return this.descentSequenceOrder
  }
  
  /**
   * Reset tracker (e.g., for new session)
   */
  reset(): void {
    this.activeRuns.clear()
    this.completedRuns = []
    this.partialRuns = []
    this.lastLocation = null
    this.gracePeriodState = {
      isActive: false,
      startTime: null,
      associatedRunId: null,
      associatedRunName: null,
      locationHistory: [],
      topSpeed: 0
    }
    this.currentDescentSessionId = null
    this.descentSequenceOrder = 0
    this.isDescentActive = false
    this.lastAltitude = null
    this.lastSpeed = null
    this.lowSpeedStartTime = null
  }
}

/**
 * Convert completed run to database format for saving
 */
export function runProgressToDbFormat(
  run: RunProgress,
  sessionId: string,
  userId: string,
  descentSessionId?: string | null,
  sequenceOrder?: number | null,
  associatedRunId?: string | null
): {
  session_id: string
  user_id: string
  ski_feature_id: string | null
  started_at: string
  completed_at: string
  duration_seconds: number
  top_speed_kmh: number | null
  avg_speed_kmh: number | null
  gps_track: object | null
  detection_method: string
  descent_session_id?: string | null
  segment_type: 'on_trail' | 'off_trail'
  sequence_order?: number | null
  associated_run_id?: string | null
  completion_percentage?: number | null
} {
  const startTime = run.startTime.toISOString()
  const endTime = (run.completedAt || new Date()).toISOString()
  const durationMs = (run.completedAt?.getTime() || Date.now()) - run.startTime.getTime()
  const durationSeconds = Math.round(durationMs / 1000)
  
  // Calculate completion percentage based on progress traveled
  const progressTraveled = run.maxProgress - run.startProgress
  const completionPercentage = Math.min(100, Math.max(0, progressTraveled * 100))
  
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
    detection_method: 'gps_proximity',
    descent_session_id: descentSessionId || null,
    segment_type: 'on_trail',
    sequence_order: sequenceOrder || null,
    associated_run_id: associatedRunId || null,
    completion_percentage: completionPercentage
  }
}

/**
 * Convert off-trail segment to database format for saving
 */
export function offTrailSegmentToDbFormat(
  segment: OffTrailSegment,
  sessionId: string,
  userId: string,
  descentSessionId?: string | null,
  sequenceOrder?: number | null
): {
  session_id: string
  user_id: string
  ski_feature_id: null
  started_at: string
  completed_at: string
  duration_seconds: number
  top_speed_kmh: number | null
  avg_speed_kmh: number | null
  gps_track: object | null
  detection_method: string
  descent_session_id?: string | null
  segment_type: 'off_trail'
  sequence_order?: number | null
  associated_run_id: string
} {
  const startTime = segment.startTime.toISOString()
  const endTime = (segment.completedAt || new Date()).toISOString()
  const durationMs = (segment.completedAt?.getTime() || Date.now()) - segment.startTime.getTime()
  const durationSeconds = Math.round(durationMs / 1000)
  
  // Calculate average speed from location history
  let avgSpeed: number | null = null
  if (segment.locationHistory.length > 0) {
    const speeds = segment.locationHistory
      .map(l => l.speed)
      .filter((s): s is number => s !== undefined && s !== null)
    if (speeds.length > 0) {
      avgSpeed = speeds.reduce((a, b) => a + b, 0) / speeds.length
    }
  }
  
  // Build GPS track GeoJSON
  let gpsTrack: object | null = null
  if (segment.locationHistory.length >= 2) {
    gpsTrack = {
      type: 'LineString',
      coordinates: segment.locationHistory.map(l => [l.lng, l.lat, l.altitude].filter(v => v !== undefined))
    }
  }
  
  return {
    session_id: sessionId,
    user_id: userId,
    ski_feature_id: null,
    started_at: startTime,
    completed_at: endTime,
    duration_seconds: durationSeconds,
    top_speed_kmh: segment.topSpeed > 0 ? segment.topSpeed : null,
    avg_speed_kmh: avgSpeed,
    gps_track: gpsTrack,
    detection_method: 'gps_proximity',
    descent_session_id: descentSessionId || null,
    segment_type: 'off_trail',
    sequence_order: sequenceOrder || null,
    associated_run_id: segment.associatedRunId
  }
}



