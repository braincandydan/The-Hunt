'use client'

import { useState, useEffect, useCallback, useRef } from 'react'

interface WakeLockState {
  isSupported: boolean
  isActive: boolean
  error: string | null
}

interface UseWakeLockReturn extends WakeLockState {
  request: () => Promise<boolean>
  release: () => Promise<void>
}

/**
 * Hook to manage the Screen Wake Lock API
 * Keeps the screen awake when enabled - useful for GPS tracking
 * 
 * @example
 * const { isActive, isSupported, request, release } = useWakeLock()
 * 
 * // Request wake lock when tracking starts
 * useEffect(() => {
 *   if (isTracking) request()
 *   else release()
 * }, [isTracking])
 */
export function useWakeLock(): UseWakeLockReturn {
  const [state, setState] = useState<WakeLockState>({
    isSupported: false,
    isActive: false,
    error: null
  })
  
  const wakeLockRef = useRef<WakeLockSentinel | null>(null)
  const requestedRef = useRef(false)

  // Check support on mount
  useEffect(() => {
    const isSupported = typeof navigator !== 'undefined' && 'wakeLock' in navigator && typeof (navigator as any).wakeLock?.request === 'function'
    setState(prev => ({ ...prev, isSupported }))
  }, [])

  // Handle visibility change - re-acquire wake lock when tab becomes visible
  useEffect(() => {
    const handleVisibilityChange = async () => {
      if (document.visibilityState === 'visible' && requestedRef.current && !wakeLockRef.current) {
        try {
          wakeLockRef.current = await (navigator as any).wakeLock.request('screen')
          setState(prev => ({ ...prev, isActive: true, error: null }))
          
          // Handle release
          if (wakeLockRef.current) {
            wakeLockRef.current.addEventListener('release', () => {
              wakeLockRef.current = null
              setState(prev => ({ ...prev, isActive: false }))
            })
          }
        } catch (err) {
          // Silently fail on re-acquire - user may have navigated away
          console.log('Wake lock re-acquire failed:', err)
        }
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange)
  }, [])

  // Request wake lock
  const request = useCallback(async (): Promise<boolean> => {
    if (!state.isSupported) {
      setState(prev => ({ 
        ...prev, 
        error: 'Wake Lock API not supported in this browser' 
      }))
      return false
    }

    // Already active
    if (wakeLockRef.current) {
      return true
    }

    try {
      requestedRef.current = true
      wakeLockRef.current = await (navigator as any).wakeLock.request('screen')
      
      setState(prev => ({ 
        ...prev, 
        isActive: true, 
        error: null 
      }))

      // Listen for release (e.g., when tab becomes hidden)
      if (wakeLockRef.current) {
        wakeLockRef.current.addEventListener('release', () => {
          wakeLockRef.current = null
          setState(prev => ({ ...prev, isActive: false }))
        })
      }

      return true
    } catch (err: any) {
      const errorMessage = err?.message || 'Failed to acquire wake lock'
      setState(prev => ({ 
        ...prev, 
        isActive: false, 
        error: errorMessage 
      }))
      return false
    }
  }, [state.isSupported])

  // Release wake lock
  const release = useCallback(async (): Promise<void> => {
    requestedRef.current = false
    
    if (wakeLockRef.current) {
      try {
        await wakeLockRef.current.release()
        wakeLockRef.current = null
        setState(prev => ({ 
          ...prev, 
          isActive: false, 
          error: null 
        }))
      } catch (err: any) {
        // Release failed, but clear anyway
        wakeLockRef.current = null
        setState(prev => ({ 
          ...prev, 
          isActive: false 
        }))
      }
    }
  }, [])

  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (wakeLockRef.current) {
        wakeLockRef.current.release().catch(() => {})
        wakeLockRef.current = null
      }
    }
  }, [])

  return {
    ...state,
    request,
    release
  }
}

// Type declarations for WakeLock API
// Using interface merging to augment Navigator if types don't exist
interface WakeLockSentinel extends EventTarget {
  readonly type: 'screen'
  readonly released: boolean
  release(): Promise<void>
  addEventListener(type: 'release', listener: () => void): void
  removeEventListener(type: 'release', listener: () => void): void
}

