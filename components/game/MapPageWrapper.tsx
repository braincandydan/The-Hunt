'use client'

import { useState, useMemo, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Sign, Resort, SkiFeature } from '@/lib/utils/types'
import MapView from './MapView'
import ProgressBar from './ProgressBar'
import SideMenu from './SideMenu'
import SignsBottomSheet from './SignsBottomSheet'
import SignDetailModal from './SignDetailModal'
import SessionSummary from './SessionSummary'
import ErrorBoundary from '@/components/ErrorBoundary'
import { useRunTracking } from '@/lib/hooks/useRunTracking'
import { useWakeLock } from '@/lib/hooks/useWakeLock'

interface MapPageWrapperProps {
  resortSlug: string
  resort: Resort
  signs: Sign[]
  discoveredSignIds: Set<string>
  skiFeatures: SkiFeature[]
}

export default function MapPageWrapper({
  resortSlug,
  resort,
  signs,
  discoveredSignIds,
  skiFeatures,
}: MapPageWrapperProps) {
  const router = useRouter()
  const [menuOpen, setMenuOpen] = useState(false)
  const [bottomSheetOpen, setBottomSheetOpen] = useState(false)
  const [selectedSign, setSelectedSign] = useState<Sign | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [speedData, setSpeedData] = useState<{ current: number | null; top: number; average: number }>({
    current: null,
    top: 0,
    average: 0,
  })
  const [isLocationTracking, setIsLocationTracking] = useState(false)
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number; altitude?: number; speed?: number } | null>(null)
  const [keepScreenAwake, setKeepScreenAwake] = useState(true) // Default to on
  
  // Wake lock for keeping screen awake during tracking
  const wakeLock = useWakeLock()
  
  // Run tracking hook - only enabled when location tracking is active
  const runTracking = useRunTracking({
    resortId: resort.id,
    skiFeatures: skiFeatures as SkiFeature[],
    enabled: isLocationTracking,
    saveLocationHistory: true,
    proximityThreshold: 30
  })
  
  // Update run tracker with location data when it changes
  // Using refs to avoid re-running on runTracking object change
  const runTrackingRef = useRef(runTracking)
  runTrackingRef.current = runTracking
  
  useEffect(() => {
    if (userLocation && isLocationTracking) {
      runTrackingRef.current.updateLocation(
        userLocation.lat,
        userLocation.lng,
        userLocation.altitude,
        userLocation.speed
      )
    }
  }, [userLocation, isLocationTracking])
  
  // Manage wake lock based on tracking and user preference
  const wakeLockRef = useRef(wakeLock)
  wakeLockRef.current = wakeLock
  
  useEffect(() => {
    if (isLocationTracking && keepScreenAwake) {
      wakeLockRef.current.request()
    } else {
      wakeLockRef.current.release()
    }
  }, [isLocationTracking, keepScreenAwake])
  
  // Callback to receive location updates from MapView
  const handleLocationUpdate = useCallback((location: { lat: number; lng: number; altitude?: number; speed?: number } | null, tracking: boolean) => {
    setUserLocation(location)
    setIsLocationTracking(tracking)
  }, [])

  const foundCount = useMemo(
    () => signs.filter((s) => discoveredSignIds.has(s.id)).length,
    [signs, discoveredSignIds]
  )
  const totalCount = signs.length

  // Calculate map center from resort config or signs - no hardcoded coordinates
  const mapCenter = useMemo((): [number, number] | undefined => {
    // First priority: Use resort's configured center
    if (resort.map_config?.center) {
      return resort.map_config.center
    }
    
    // Second priority: Calculate center from signs
    if (signs.length > 0) {
      const avgLat = signs.reduce((sum, s) => sum + parseFloat(s.lat.toString()), 0) / signs.length
      const avgLng = signs.reduce((sum, s) => sum + parseFloat(s.lng.toString()), 0) / signs.length
      return [avgLat, avgLng]
    }
    
    // No center available - let MapView handle defaults
    return undefined
  }, [resort.map_config?.center, signs])

  const handleSignClick = (sign: Sign) => {
    setSelectedSign(sign)
    setModalOpen(true)
    setBottomSheetOpen(false)
  }

  const handleCloseModal = () => {
    setModalOpen(false)
    setSelectedSign(null)
  }

  const handleSignFound = () => {
    // Refresh server data to update discoveries without full page reload
    router.refresh()
  }

  // Custom fallback for 3D map errors
  const map3DErrorFallback = (
    <div className="w-full h-full flex flex-col items-center justify-center bg-gray-100 p-8">
      <div className="text-yellow-600 mb-4">
        <svg className="w-16 h-16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
      </div>
      <h2 className="text-xl font-bold text-gray-800 mb-2">Map Loading Error</h2>
      <p className="text-gray-600 text-center mb-4 max-w-md">
        There was a problem loading the map. This may be due to WebGL compatibility issues or network problems.
      </p>
      <button
        onClick={() => window.location.reload()}
        className="px-6 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition font-medium"
      >
        Reload Page
      </button>
    </div>
  )

  return (
    <div className="fixed inset-0 w-full h-full">
      {/* Map wrapped in error boundary for graceful error handling */}
      <ErrorBoundary fallback={map3DErrorFallback}>
        <MapView
          resortSlug={resortSlug}
          signs={signs}
          discoveredSignIds={discoveredSignIds}
          skiFeatures={skiFeatures.map(f => ({
            id: f.id,
            name: f.name,
            type: f.type,
            difficulty: f.difficulty || undefined,
            geometry: f.geometry,
            status: f.status || undefined,
          }))}
          resortName={resort.name}
          onSpeedUpdate={setSpeedData}
          onLocationUpdate={handleLocationUpdate}
          scene3DUrl="/3d-map/index.html"
          scene3DCenter={mapCenter}
          additionalGeoJSONPaths={[
            '/3d-map/geojson/TreeBackground.geojson',
            '/3d-map/geojson/SkiRunBackground.geojson',
          ]}
        />
      </ErrorBoundary>

      {/* Progress Bar */}
      <ProgressBar foundCount={foundCount} totalCount={totalCount} speedData={speedData} />

      {/* Menu Button */}
      <button
        onClick={() => setMenuOpen(true)}
        className="fixed top-20 left-4 z-[1001] bg-white rounded-full p-3 shadow-lg hover:shadow-xl transition-all hover:scale-105 touch-manipulation"
        aria-label="Open menu"
      >
        <svg className="w-6 h-6 text-gray-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>

      {/* Side Menu */}
      <SideMenu
        resort={resort}
        isOpen={menuOpen}
        onClose={() => setMenuOpen(false)}
      />

      {/* Bottom Sheet */}
      <SignsBottomSheet
        signs={signs}
        discoveredSignIds={discoveredSignIds}
        isOpen={bottomSheetOpen}
        onClose={() => {
          setBottomSheetOpen(false)
          if (typeof window !== 'undefined') {
            document.body.style.overflow = ''
          }
        }}
        onSignClick={handleSignClick}
      />

      {/* Session Summary - shows when tracking and not showing bottom sheet */}
      {isLocationTracking && !bottomSheetOpen && (
        <div className="fixed bottom-16 left-4 right-4 z-[1000]">
          <SessionSummary
            totalRuns={runTracking.todayStats.totalRuns}
            uniqueRuns={runTracking.todayStats.uniqueRuns}
            topSpeed={runTracking.todayStats.topSpeed}
            activeRuns={runTracking.activeRuns}
            completedRuns={runTracking.completedRuns}
            isTracking={runTracking.todayStats.isTracking}
            wakeLockSupported={wakeLock.isSupported}
            wakeLockActive={wakeLock.isActive}
            keepScreenAwake={keepScreenAwake}
            onToggleKeepAwake={() => setKeepScreenAwake(!keepScreenAwake)}
          />
        </div>
      )}

      {/* Bottom Tab Button (triggers bottom sheet) */}
      {!bottomSheetOpen && (
        <div className="fixed bottom-0 left-0 right-0 z-[1001] safe-area-bottom flex">
          <button
            onClick={() => setBottomSheetOpen(true)}
            className="flex-1 bg-indigo-600 text-white py-4 px-6 shadow-lg hover:bg-indigo-700 transition font-semibold text-center"
          >
            Signs to Find ({foundCount}/{totalCount})
          </button>
          <Link
            href={`/${resortSlug}/game/history`}
            className="bg-gray-800 text-white py-4 px-4 shadow-lg hover:bg-gray-700 transition flex items-center justify-center border-l border-gray-700"
            title="View session history"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
          </Link>
        </div>
      )}

      {/* Sign Detail Modal */}
      <SignDetailModal
        sign={selectedSign}
        isOpen={modalOpen}
        onClose={handleCloseModal}
        resortSlug={resortSlug}
        isFound={selectedSign ? discoveredSignIds.has(selectedSign.id) : false}
        onSignFound={handleSignFound}
      />
    </div>
  )
}

