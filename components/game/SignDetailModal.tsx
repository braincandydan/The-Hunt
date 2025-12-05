'use client'

import { Sign } from '@/lib/utils/types'
import QRScanner from './QRScanner'

interface SignDetailModalProps {
  sign: Sign | null
  isOpen: boolean
  onClose: () => void
  resortSlug: string
  isFound: boolean
  onSignFound?: () => void
}

export default function SignDetailModal({
  sign,
  isOpen,
  onClose,
  resortSlug,
  isFound,
  onSignFound,
}: SignDetailModalProps) {
  if (!sign || !isOpen) return null

  // Prevent body scroll when modal is open
  if (typeof window !== 'undefined') {
    if (isOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 z-[1002] transition-opacity"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="fixed inset-0 z-[1003] flex items-center justify-center p-4 pointer-events-none">
        <div
          className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto pointer-events-auto"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
            <h2 className="text-xl font-bold text-gray-900">{sign.name}</h2>
            <button
              onClick={onClose}
              className="p-2 -mr-2 text-gray-400 hover:text-gray-600 transition"
              aria-label="Close modal"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Content */}
          <div className="px-6 py-4 space-y-4">
            {sign.description && (
              <div>
                <h3 className="text-sm font-semibold text-gray-700 mb-1">Description</h3>
                <p className="text-gray-600">{sign.description}</p>
              </div>
            )}

            {sign.hint && (
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                <h3 className="text-sm font-semibold text-yellow-800 mb-1">Hint</h3>
                <p className="text-yellow-700">{sign.hint}</p>
              </div>
            )}

            {sign.photo_url && (
              <div>
                <img
                  src={sign.photo_url}
                  alt={sign.name}
                  className="w-full rounded-lg"
                />
              </div>
            )}

            {isFound && (
              <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                <p className="text-green-800 font-semibold flex items-center">
                  <svg className="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                  You found this sign!
                </p>
              </div>
            )}

            {!isFound && (
              <div className="pt-4 border-t border-gray-200">
                <h3 className="text-sm font-semibold text-gray-700 mb-3">Scan QR Code</h3>
                <QRScanner
                  resortSlug={resortSlug}
                  signId={sign.id}
                  onSuccess={() => {
                    if (onSignFound) {
                      onSignFound()
                    }
                    // Close modal and refresh after delay
                    setTimeout(() => {
                      onClose()
                      window.location.reload()
                    }, 1500)
                  }}
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  )
}

