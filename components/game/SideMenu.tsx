'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Resort } from '@/lib/utils/types'
import UserProfile from './UserProfile'

interface SideMenuProps {
  resort: Resort
  isOpen: boolean
  onClose: () => void
}

export default function SideMenu({ resort, isOpen, onClose }: SideMenuProps) {
  const [showProfile, setShowProfile] = useState(false)

  // Prevent body scroll when menu is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [isOpen])

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
              <div className="mt-4">
                <img
                  src={resort.theme_config.logoUrl}
                  alt={`${resort.name} logo`}
                  className="h-12 w-auto object-contain"
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
                  onClick={() => {
                    // Placeholder - no action yet
                    console.log('Resort Info clicked')
                  }}
                  className="w-full text-left px-4 py-3 rounded-lg hover:bg-gray-50 transition flex items-center space-x-3"
                >
                  <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span className="font-medium text-gray-700">Resort Info</span>
                </button>

                <button
                  onClick={() => {
                    // Placeholder - no action yet
                    console.log('Contact Ski Patrol clicked')
                  }}
                  className="w-full text-left px-4 py-3 rounded-lg hover:bg-gray-50 transition flex items-center space-x-3"
                >
                  <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                  </svg>
                  <span className="font-medium text-gray-700">Contact Ski Patrol</span>
                </button>

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

