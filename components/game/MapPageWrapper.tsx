'use client'

import { useState } from 'react'
import { Sign, Resort, SkiFeature } from '@/lib/utils/types'
import MapView from './MapView'
import ProgressBar from './ProgressBar'
import SideMenu from './SideMenu'
import SignsBottomSheet from './SignsBottomSheet'
import SignDetailModal from './SignDetailModal'

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
  const [menuOpen, setMenuOpen] = useState(false)
  const [bottomSheetOpen, setBottomSheetOpen] = useState(false)
  const [selectedSign, setSelectedSign] = useState<Sign | null>(null)
  const [modalOpen, setModalOpen] = useState(false)

  const foundCount = signs.filter((s) => discoveredSignIds.has(s.id)).length
  const totalCount = signs.length

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
    // Refresh the page to update discoveries
    window.location.reload()
  }

  return (
    <div className="fixed inset-0 w-full h-full">
      {/* Map */}
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
      />

      {/* Progress Bar */}
      <ProgressBar foundCount={foundCount} totalCount={totalCount} />

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

      {/* Bottom Tab Button (triggers bottom sheet) */}
      {!bottomSheetOpen && (
        <button
          onClick={() => setBottomSheetOpen(true)}
          className="fixed bottom-0 left-0 right-0 bg-indigo-600 text-white py-4 px-6 z-[1001] shadow-lg hover:bg-indigo-700 transition font-semibold text-center safe-area-bottom"
        >
          Signs to Find ({foundCount}/{totalCount})
        </button>
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

