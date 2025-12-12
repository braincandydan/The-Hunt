'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { SkiFeature, SkiSession, RunCompletion } from '@/lib/utils/types'
import { RunTracker, RunProgress, runProgressToDbFormat } from '@/lib/utils/run-tracking'

interface UseRunTrackingOptions {
  resortId: string
  skiFeatures: SkiFeature[]
  enabled?: boolean
  saveLocationHistory?: boolean
  locationSaveInterval?: number // Save location every N seconds
  proximityThreshold?: number // meters
}

interface RunTrackingState {
  session: SkiSession | null
  activeRuns: RunProgress[]
  completedRuns: RunProgress[]
  todayStats: {
    totalRuns: number
    uniqueRuns: number
    topSpeed: number
    isTracking: boolean
  }
  error: string | null
}

export function useRunTracking({
  resortId,
  skiFeatures,
  enabled = true,
  saveLocationHistory = true,
  locationSaveInterval = 5, // Every 5 seconds
  proximityThreshold = 30
}: UseRunTrackingOptions) {
  const [state, setState] = useState<RunTrackingState>({
    session: null,
    activeRuns: [],
    completedRuns: [],
    todayStats: {
      totalRuns: 0,
      uniqueRuns: 0,
      topSpeed: 0,
      isTracking: false
    },
    error: null
  })
  
  const trackerRef = useRef<RunTracker | null>(null)
  const supabaseRef = useRef(createClient())
  const userIdRef = useRef<string | null>(null)
  const sessionIdRef = useRef<string | null>(null)
  const lastLocationSaveRef = useRef<number>(0)
  const pendingCompletionsRef = useRef<RunProgress[]>([])
  
  // Initialize tracker with ski features
  useEffect(() => {
    trackerRef.current = new RunTracker(skiFeatures, { proximityThreshold })
    
    return () => {
      trackerRef.current?.reset()
    }
  }, [skiFeatures, proximityThreshold])
  
  // Get or create session
  const initializeSession = useCallback(async () => {
    try {
      const supabase = supabaseRef.current
      const { data: { user } } = await supabase.auth.getUser()
      
      if (!user) {
        // Not logged in - silently skip (don't show error for this case)
        return null
      }
      
      userIdRef.current = user.id
      
      // Use the database function to get or create session
      // This may fail if migration hasn't been run yet - that's OK
      const { data: sessionId, error: funcError } = await supabase
        .rpc('get_or_create_session', {
          p_user_id: user.id,
          p_resort_id: resortId
        })
      
      if (funcError) {
        // Database tables may not exist yet - run tracking will be disabled
        console.warn('Run tracking not available:', funcError.message)
        return null
      }
      
      sessionIdRef.current = sessionId
      
      // Fetch the full session data
      const { data: session, error: sessionError } = await supabase
        .from('ski_sessions')
        .select('*')
        .eq('id', sessionId)
        .single()
      
      if (sessionError) {
        console.warn('Error fetching session:', sessionError.message)
        return null
      }
      
      // Fetch today's completions
      const { data: completions } = await supabase
        .from('run_completions')
        .select(`
          *,
          ski_feature:ski_features(id, name, type, difficulty)
        `)
        .eq('session_id', sessionId)
        .order('completed_at', { ascending: false })
      
      setState(prev => ({
        ...prev,
        session,
        todayStats: {
          ...prev.todayStats,
          totalRuns: completions?.length || 0,
          uniqueRuns: new Set(completions?.map(c => c.ski_feature_id) || []).size,
          isTracking: true
        },
        error: null
      }))
      
      return sessionId
    } catch (error) {
      console.error('Session initialization error:', error)
      setState(prev => ({ ...prev, error: 'Failed to initialize session' }))
      return null
    }
  }, [resortId])
  
  // Initialize session on mount if enabled
  useEffect(() => {
    if (enabled) {
      initializeSession()
    }
  }, [enabled, initializeSession])
  
  // Save run completion to database
  const saveRunCompletion = useCallback(async (run: RunProgress) => {
    if (!sessionIdRef.current || !userIdRef.current) {
      pendingCompletionsRef.current.push(run)
      return false
    }
    
    try {
      const supabase = supabaseRef.current
      const dbRun = runProgressToDbFormat(run, sessionIdRef.current, userIdRef.current)
      
      const { error } = await supabase
        .from('run_completions')
        .insert(dbRun)
      
      if (error) {
        console.warn('Error saving run completion:', error.message)
        pendingCompletionsRef.current.push(run)
        return false
      }
      
      // Update local state
      setState(prev => ({
        ...prev,
        todayStats: {
          ...prev.todayStats,
          totalRuns: prev.todayStats.totalRuns + 1,
          uniqueRuns: new Set([
            ...prev.completedRuns.map(r => r.featureId),
            run.featureId
          ]).size,
          topSpeed: Math.max(prev.todayStats.topSpeed, run.topSpeed)
        }
      }))
      
      return true
    } catch (err) {
      console.warn('Failed to save run completion:', err)
      pendingCompletionsRef.current.push(run)
      return false
    }
  }, [])
  
  // Save location to history
  const saveLocation = useCallback(async (
    lat: number,
    lng: number,
    altitude?: number,
    speed?: number,
    accuracy?: number
  ) => {
    if (!saveLocationHistory || !sessionIdRef.current || !userIdRef.current) return
    
    const now = Date.now()
    if (now - lastLocationSaveRef.current < locationSaveInterval * 1000) return
    lastLocationSaveRef.current = now
    
    const supabase = supabaseRef.current
    
    const insertData = {
      session_id: sessionIdRef.current,
      user_id: userIdRef.current,
      latitude: lat,
      longitude: lng,
      altitude_meters: altitude,
      speed_kmh: speed,
      accuracy_meters: accuracy
    }
    
    // Log database save for verification
    if (speed !== null && speed !== undefined && speed > 0) {
      if (process.env.NODE_ENV === 'development') {
        console.log(`[SPEED LOGGING] Saving to database: ${speed.toFixed(1)} km/h`)
      }
    }
    
    const { error } = await supabase.from('location_history').insert(insertData)
    
    if (error && process.env.NODE_ENV === 'development') {
      console.warn('[SPEED LOGGING] Database save error:', error)
    } else if (speed !== null && speed !== undefined && speed > 0) {
      if (process.env.NODE_ENV === 'development') {
        console.log(`[SPEED LOGGING] Successfully saved speed to database`)
      }
    }
  }, [saveLocationHistory, locationSaveInterval])
  
  // Throttle state updates to prevent excessive re-renders
  const lastStateUpdateRef = useRef<number>(0)
  const STATE_UPDATE_INTERVAL = 2000 // Update state max once per 2 seconds
  
  // Main location update function
  const updateLocation = useCallback((
    lat: number,
    lng: number,
    altitude?: number,
    speed?: number,
    accuracy?: number
  ) => {
    if (!trackerRef.current || !enabled) return
    
    // Update tracker and get newly completed runs
    const newlyCompleted = trackerRef.current.updateLocation(lat, lng, altitude, speed)
    
    // Save completed runs to database (async, doesn't cause re-render)
    for (const run of newlyCompleted) {
      saveRunCompletion(run)
    }
    
    // Save location to history (async, doesn't cause re-render)
    saveLocation(lat, lng, altitude, speed, accuracy)
    
    // Log speed for verification (only when speed is available)
    if (speed !== null && speed !== undefined && speed > 0) {
      if (process.env.NODE_ENV === 'development') {
        console.log(`[SPEED TRACKING] Speed recorded: ${speed.toFixed(1)} km/h at (${lat.toFixed(6)}, ${lng.toFixed(6)})`)
      }
    }
    
    // Throttle state updates to prevent excessive re-renders
    const now = Date.now()
    if (now - lastStateUpdateRef.current >= STATE_UPDATE_INTERVAL) {
      lastStateUpdateRef.current = now
      setState(prev => ({
        ...prev,
        activeRuns: trackerRef.current?.getActiveRuns() || [],
        completedRuns: trackerRef.current?.getCompletedRuns() || [],
        todayStats: {
          ...prev.todayStats,
          topSpeed: Math.max(prev.todayStats.topSpeed, trackerRef.current?.getTopSpeed() || 0)
        }
      }))
    }
  }, [enabled, saveRunCompletion, saveLocation])
  
  // Manual run completion (e.g., from QR scan at run marker)
  const markRunCompleted = useCallback(async (featureId: string): Promise<boolean> => {
    if (!trackerRef.current) return false
    
    const success = trackerRef.current.markRunCompleted(featureId, 'qr_scan')
    if (!success) return false
    
    const completedRuns = trackerRef.current.getCompletedRuns()
    const lastRun = completedRuns[completedRuns.length - 1]
    
    if (lastRun) {
      await saveRunCompletion(lastRun)
    }
    
    setState(prev => ({
      ...prev,
      completedRuns: trackerRef.current?.getCompletedRuns() || []
    }))
    
    return true
  }, [saveRunCompletion])
  
  // End tracking session
  const endSession = useCallback(async () => {
    if (!sessionIdRef.current) return
    
    const supabase = supabaseRef.current
    
    // Calculate metrics from location_history
    const { data: metrics } = await supabase
      .rpc('calculate_session_metrics', { p_session_id: sessionIdRef.current })
    
    // Get max speed and avg speed from location_history
    const { data: speedData } = await supabase
      .from('location_history')
      .select('speed_kmh')
      .eq('session_id', sessionIdRef.current)
      .not('speed_kmh', 'is', null)
    
    const speeds = speedData?.map(d => d.speed_kmh).filter(s => s !== null && s > 0) || []
    const maxSpeed = speeds.length > 0 ? Math.max(...speeds) : 0
    const avgSpeed = speeds.length > 0 ? speeds.reduce((a, b) => a + b, 0) / speeds.length : 0
    
    // Update session with all calculated stats
    await supabase
      .from('ski_sessions')
      .update({
        ended_at: new Date().toISOString(),
        is_active: false,
        total_distance_meters: metrics?.[0]?.total_distance || 0,
        total_vertical_meters: metrics?.[0]?.total_vertical || 0,
        top_speed_kmh: Math.max(session.top_speed_kmh || 0, maxSpeed),
        avg_speed_kmh: avgSpeed
      })
      .eq('id', sessionIdRef.current)
    
    // Process any pending completions
    for (const run of pendingCompletionsRef.current) {
      await saveRunCompletion(run)
    }
    pendingCompletionsRef.current = []
    
    setState(prev => ({
      ...prev,
      todayStats: {
        ...prev.todayStats,
        isTracking: false
      }
    }))
  }, [saveRunCompletion])
  
  // Fetch session history
  const getSessionHistory = useCallback(async (days: number = 30): Promise<SkiSession[]> => {
    const supabase = supabaseRef.current
    const { data: { user } } = await supabase.auth.getUser()
    
    if (!user) return []
    
    const { data: sessions } = await supabase
      .from('ski_sessions')
      .select(`
        *,
        resort:resorts(id, name, slug)
      `)
      .eq('user_id', user.id)
      .gte('session_date', new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0])
      .order('session_date', { ascending: false })
    
    return sessions || []
  }, [])
  
  // Fetch run completions for a session
  const getSessionRuns = useCallback(async (sessionId: string): Promise<RunCompletion[]> => {
    const supabase = supabaseRef.current
    
    const { data: completions } = await supabase
      .from('run_completions')
      .select(`
        *,
        ski_feature:ski_features(id, name, type, difficulty, geometry)
      `)
      .eq('session_id', sessionId)
      .order('completed_at', { ascending: true })
    
    return completions || []
  }, [])
  
  // Fetch location history for a session (for route visualization)
  const getSessionRoute = useCallback(async (sessionId: string) => {
    const supabase = supabaseRef.current
    
    const { data: locations } = await supabase
      .from('location_history')
      .select('latitude, longitude, altitude_meters, speed_kmh, recorded_at')
      .eq('session_id', sessionId)
      .order('recorded_at', { ascending: true })
    
    if (!locations || locations.length < 2) return null
    
    // Convert to GeoJSON LineString
    return {
      type: 'LineString' as const,
      coordinates: locations.map(l => [l.longitude, l.latitude, l.altitude_meters].filter(v => v !== null))
    }
  }, [])
  
  return {
    ...state,
    updateLocation,
    markRunCompleted,
    endSession,
    getSessionHistory,
    getSessionRuns,
    getSessionRoute,
    isReady: !!sessionIdRef.current
  }
}

