'use client'

import Link from 'next/link'

interface MobileBottomMenuProps {
  resortSlug: string
  foundCount: number
  totalCount: number
  isTrackingLocation: boolean
  onToggleLocationTracking: () => void
  onOpenSignsSheet: () => void
  onOpenMenu: () => void
  bottomSheetOpen: boolean
}

export default function MobileBottomMenu({
  resortSlug,
  foundCount,
  totalCount,
  isTrackingLocation,
  onToggleLocationTracking,
  onOpenSignsSheet,
  onOpenMenu,
  bottomSheetOpen,
}: MobileBottomMenuProps) {
  // Don't show menu when bottom sheet is open
  if (bottomSheetOpen) {
    return null
  }

  return (
    <div className="fixed bottom-0 left-0 right-0 z-[1001] safe-area-bottom">
      {/* Main Bottom Bar */}
      <div className="bg-white border-t border-gray-200 shadow-lg">
        <div className="flex items-stretch h-full">
          {/* Menu Button */}
          <button
            onClick={onOpenMenu}
            className="flex-1 px-2 py-6 bg-gray-50 text-gray-700 hover:bg-gray-100 transition flex flex-col items-center justify-center gap-1 border-r border-gray-200"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
            <span className="text-xs font-medium">Menu</span>
          </button>

          {/* Signs Button */}
          <button
            onClick={onOpenSignsSheet}
            className="flex-1 px-2 bg-gray-50 text-gray-700 hover:bg-gray-100 transition flex flex-col items-center justify-center gap-0.5 border-r border-gray-200"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
            </svg>
            <div className="flex flex-col items-center leading-tight">
              <span className="text-xs font-medium">Signs</span>
              <span className="text-[10px] opacity-75">{foundCount}/{totalCount}</span>
            </div>
          </button>

          {/* Location Tracking Button */}
          <button
            onClick={onToggleLocationTracking}
            className="flex-1 px-2 bg-gray-50 text-gray-700 hover:bg-gray-100 transition flex flex-col items-center justify-center gap-1 border-r border-gray-200"
          >
            {isTrackingLocation ? (
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 10a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" />
              </svg>
            ) : (
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            )}
            <span className="text-xs font-medium">
              {isTrackingLocation ? 'Tracking' : 'Track'}
            </span>
          </button>

          {/* History Button */}
          <Link
            href={`/${resortSlug}/game/history`}
            className="flex-1 px-2 bg-gray-50 text-gray-700 hover:bg-gray-100 transition flex flex-col items-center justify-center gap-1"
            title="View session history"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
            <span className="text-xs font-medium">History</span>
          </Link>
        </div>
      </div>
    </div>
  )
}
