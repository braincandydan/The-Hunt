'use client'

import { useEffect, useMemo } from 'react'
import { Sign } from '@/lib/utils/types'

interface SignsBottomSheetProps {
  signs: Sign[]
  discoveredSignIds: Set<string>
  isOpen: boolean
  onClose: () => void
  onSignClick: (sign: Sign) => void
}

export default function SignsBottomSheet({
  signs,
  discoveredSignIds,
  isOpen,
  onClose,
  onSignClick,
}: SignsBottomSheetProps) {
  // Prevent body scroll when sheet is open - properly handled in useEffect
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    
    // Cleanup on unmount
    return () => {
      document.body.style.overflow = ''
    }
  }, [isOpen])

  const foundCount = useMemo(
    () => signs.filter((s) => discoveredSignIds.has(s.id)).length,
    [signs, discoveredSignIds]
  )

  return (
    <>
      {/* Backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-[1002] transition-opacity"
          onClick={onClose}
        />
      )}

      {/* Bottom Sheet */}
      <div
        className={`fixed bottom-0 left-0 right-0 bg-white rounded-t-2xl shadow-2xl z-[1003] transform transition-transform duration-300 ease-out max-h-[85vh] flex flex-col ${
          isOpen ? 'translate-y-0' : 'translate-y-full'
        }`}
      >
        {/* Handle */}
        <div className="flex justify-center pt-3 pb-2">
          <div className="w-12 h-1.5 bg-gray-300 rounded-full" />
        </div>

        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-bold text-gray-900">Signs to Find</h2>
              <p className="text-sm text-gray-600 mt-1">
                {foundCount} of {signs.length} found
              </p>
            </div>
            <button
              onClick={onClose}
              className="p-2 -mr-2 text-gray-400 hover:text-gray-600 transition"
              aria-label="Close"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Signs List */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {signs.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <p>No signs available</p>
            </div>
          ) : (
            <div className="space-y-2">
              {signs.map((sign) => {
                const isFound = discoveredSignIds.has(sign.id)
                return (
                  <button
                    key={sign.id}
                    onClick={() => onSignClick(sign)}
                    className={`w-full text-left px-4 py-3 rounded-lg transition ${
                      isFound
                        ? 'bg-green-50 border border-green-200 hover:bg-green-100'
                        : 'bg-gray-50 border border-gray-200 hover:bg-gray-100'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center space-x-2">
                          {isFound ? (
                            <svg className="w-5 h-5 text-green-600 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                            </svg>
                          ) : (
                            <div className="w-5 h-5 rounded-full border-2 border-gray-300 flex-shrink-0" />
                          )}
                          <h3 className={`font-semibold truncate ${isFound ? 'text-green-900' : 'text-gray-900'}`}>
                            {sign.name}
                          </h3>
                        </div>
                        {sign.description && (
                          <p className="text-sm text-gray-600 mt-1 line-clamp-2">{sign.description}</p>
                        )}
                      </div>
                      {sign.difficulty && (
                        <span
                          className={`ml-2 px-2 py-1 text-xs font-semibold rounded-full flex-shrink-0 ${
                            sign.difficulty === 'easy'
                              ? 'bg-green-100 text-green-800'
                              : sign.difficulty === 'medium'
                              ? 'bg-yellow-100 text-yellow-800'
                              : 'bg-red-100 text-red-800'
                          }`}
                        >
                          {sign.difficulty}
                        </span>
                      )}
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </div>

    </>
  )
}

