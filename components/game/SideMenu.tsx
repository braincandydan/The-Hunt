'use client'

import { useState, memo } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { Resort } from '@/lib/utils/types'
import UserProfile from './UserProfile'
import { useBodyScrollLock } from '@/lib/hooks/useBodyScrollLock'

interface SideMenuProps {
  resort: Resort
  isOpen: boolean
  onClose: () => void
}

function SideMenu({ resort, isOpen, onClose }: SideMenuProps) {
  const [showProfile, setShowProfile] = useState(false)

  // Prevent body scroll when menu is open
  useBodyScrollLock(isOpen)

  return (
    <>
      {/* Backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-[1002] transition-opacity"
          onClick={onClose}
        />
      )}

      {/* Menu */}
      <div
        className={`fixed top-0 left-0 h-full w-80 max-w-[85vw] bg-white z-[1003] shadow-xl transform transition-transform duration-300 ease-out ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex flex-col h-full">
          {/* Header */}
          <div className="p-4 border-b border-gray-200">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-gray-900">{resort.name}</h2>
              <button
                onClick={onClose}
                className="p-2 -mr-2 text-gray-400 hover:text-gray-600 transition"
                aria-label="Close menu"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            {resort.theme_config?.logoUrl && (
              <div className="mt-4 relative h-12">
                <Image
                  src={resort.theme_config.logoUrl}
                  alt={`${resort.name} logo`}
                  height={48}
                  width={200}
                  className="h-12 w-auto object-contain"
                  unoptimized
                />
              </div>
            )}
          </div>

          {/* Menu Items */}
          <div className="flex-1 overflow-y-auto">
            {showProfile ? (
              <div className="p-4">
                <button
                  onClick={() => setShowProfile(false)}
                  className="mb-4 text-sm text-indigo-600 hover:text-indigo-700 flex items-center"
                >
                  <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                  Back
                </button>
                <UserProfile onClose={() => {
                  setShowProfile(false)
                  onClose()
                }} />
              </div>
            ) : (
              <div className="p-4 space-y-2">
                <button
                  type="button"
                  className="w-full text-left px-4 py-3 rounded-lg hover:bg-gray-50 transition flex items-center space-x-3"
                  aria-label="Resort Info (coming soon)"
                >
                  <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span className="font-medium text-gray-700">Resort Info</span>
                </button>

                <button
                  type="button"
                  className="w-full text-left px-4 py-3 rounded-lg hover:bg-gray-50 transition flex items-center space-x-3"
                  aria-label="Contact Ski Patrol (coming soon)"
                >
                  <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                  </svg>
                  <span className="font-medium text-gray-700">Contact Ski Patrol</span>
                </button>

                <div className="border-t border-gray-200 my-4" />
                
                <Link
                  href={`/${resort.slug}/game/history`}
                  onClick={onClose}
                  className="w-full text-left px-4 py-3 rounded-lg hover:bg-gray-50 transition flex items-center space-x-3"
                >
                  <svg className="w-5 h-5 text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                  </svg>
                  <div>
                    <span className="font-medium text-gray-700">Session History</span>
                    <p className="text-xs text-gray-500">View your skiing activity</p>
                  </div>
                </Link>

                <div className="border-t border-gray-200 my-4" />

                <button
                  onClick={() => setShowProfile(true)}
                  className="w-full text-left px-4 py-3 rounded-lg hover:bg-gray-50 transition flex items-center space-x-3"
                >
                  <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  </svg>
                  <span className="font-medium text-gray-700">Profile Settings</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  )
}

export default memo(SideMenu)
