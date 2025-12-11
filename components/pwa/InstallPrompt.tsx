'use client'

import { useState, useEffect } from 'react'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

// Detect iOS Safari
function isIOS(): boolean {
  if (typeof window === 'undefined') return false
  return /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream
}

// Detect if running as standalone PWA
function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as any).standalone === true
  )
}

export default function InstallPrompt() {
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [showBanner, setShowBanner] = useState(false)
  const [showIOSInstructions, setShowIOSInstructions] = useState(false)
  const [isIOSDevice, setIsIOSDevice] = useState(false)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    // Check if already installed or dismissed
    if (isStandalone()) return
    
    const wasDismissed = localStorage.getItem('pwa-install-dismissed')
    if (wasDismissed) {
      const dismissedAt = parseInt(wasDismissed, 10)
      // Show again after 7 days
      if (Date.now() - dismissedAt < 7 * 24 * 60 * 60 * 1000) {
        setDismissed(true)
        return
      }
    }

    // Check for iOS
    if (isIOS()) {
      setIsIOSDevice(true)
      // Show iOS banner after a short delay
      const timer = setTimeout(() => setShowBanner(true), 3000)
      return () => clearTimeout(timer)
    }

    // Listen for beforeinstallprompt (Android/Desktop Chrome)
    const handler = (e: Event) => {
      e.preventDefault()
      setInstallPrompt(e as BeforeInstallPromptEvent)
      // Show banner after a short delay
      setTimeout(() => setShowBanner(true), 2000)
    }

    window.addEventListener('beforeinstallprompt', handler)

    return () => {
      window.removeEventListener('beforeinstallprompt', handler)
    }
  }, [])

  const handleInstall = async () => {
    if (!installPrompt) return

    await installPrompt.prompt()
    const result = await installPrompt.userChoice

    if (result.outcome === 'accepted') {
      setShowBanner(false)
      setInstallPrompt(null)
    }
  }

  const handleDismiss = () => {
    setShowBanner(false)
    setShowIOSInstructions(false)
    setDismissed(true)
    localStorage.setItem('pwa-install-dismissed', Date.now().toString())
  }

  // Don't render if already installed or dismissed
  if (isStandalone() || dismissed || !showBanner) return null

  return (
    <>
      {/* Install Banner */}
      <div className="fixed bottom-20 left-4 right-4 z-[2000] animate-slide-up">
        <div className="bg-gradient-to-r from-indigo-600 to-purple-600 rounded-2xl shadow-2xl p-4 text-white">
          <div className="flex items-start gap-4">
            {/* App Icon */}
            <div className="w-14 h-14 bg-white/20 rounded-xl flex items-center justify-center flex-shrink-0">
              <svg className="w-8 h-8" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" strokeWidth="2" stroke="currentColor" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>

            {/* Content */}
            <div className="flex-1 min-w-0">
              <h3 className="font-bold text-lg">Install The Hunt</h3>
              <p className="text-white/80 text-sm mt-1">
                {isIOSDevice 
                  ? 'Add to your home screen for the best experience'
                  : 'Install the app for faster access and offline support'
                }
              </p>

              {/* Action buttons */}
              <div className="flex gap-2 mt-3">
                {isIOSDevice ? (
                  <button
                    onClick={() => setShowIOSInstructions(true)}
                    className="px-4 py-2 bg-white text-indigo-600 font-semibold rounded-lg text-sm hover:bg-gray-100 transition"
                  >
                    Show Me How
                  </button>
                ) : (
                  <button
                    onClick={handleInstall}
                    className="px-4 py-2 bg-white text-indigo-600 font-semibold rounded-lg text-sm hover:bg-gray-100 transition"
                  >
                    Install App
                  </button>
                )}
                <button
                  onClick={handleDismiss}
                  className="px-4 py-2 bg-white/20 font-semibold rounded-lg text-sm hover:bg-white/30 transition"
                >
                  Not Now
                </button>
              </div>
            </div>

            {/* Close button */}
            <button
              onClick={handleDismiss}
              className="p-1 hover:bg-white/20 rounded-lg transition"
              aria-label="Close"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* iOS Instructions Modal */}
      {showIOSInstructions && (
        <div className="fixed inset-0 z-[2001] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-white rounded-2xl max-w-sm w-full overflow-hidden shadow-2xl">
            <div className="bg-gradient-to-r from-indigo-600 to-purple-600 p-4 text-white">
              <h3 className="font-bold text-xl">Install on iOS</h3>
              <p className="text-white/80 text-sm mt-1">Follow these steps to add the app</p>
            </div>

            <div className="p-4 space-y-4">
              {/* Step 1 */}
              <div className="flex gap-3">
                <div className="w-8 h-8 bg-indigo-100 text-indigo-600 rounded-full flex items-center justify-center font-bold flex-shrink-0">
                  1
                </div>
                <div>
                  <p className="font-medium text-gray-900">Tap the Share button</p>
                  <p className="text-sm text-gray-500 mt-1">
                    Look for the{' '}
                    <span className="inline-flex items-center">
                      <svg className="w-5 h-5 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                      </svg>
                    </span>{' '}
                    icon at the bottom of Safari
                  </p>
                </div>
              </div>

              {/* Step 2 */}
              <div className="flex gap-3">
                <div className="w-8 h-8 bg-indigo-100 text-indigo-600 rounded-full flex items-center justify-center font-bold flex-shrink-0">
                  2
                </div>
                <div>
                  <p className="font-medium text-gray-900">Select "Add to Home Screen"</p>
                  <p className="text-sm text-gray-500 mt-1">
                    Scroll down in the share menu to find this option
                  </p>
                </div>
              </div>

              {/* Step 3 */}
              <div className="flex gap-3">
                <div className="w-8 h-8 bg-indigo-100 text-indigo-600 rounded-full flex items-center justify-center font-bold flex-shrink-0">
                  3
                </div>
                <div>
                  <p className="font-medium text-gray-900">Tap "Add"</p>
                  <p className="text-sm text-gray-500 mt-1">
                    The app will appear on your home screen
                  </p>
                </div>
              </div>
            </div>

            <div className="p-4 border-t border-gray-200">
              <button
                onClick={() => setShowIOSInstructions(false)}
                className="w-full py-3 bg-indigo-600 text-white font-semibold rounded-xl hover:bg-indigo-700 transition"
              >
                Got it!
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Animation styles */}
      <style jsx>{`
        @keyframes slide-up {
          from {
            transform: translateY(100%);
            opacity: 0;
          }
          to {
            transform: translateY(0);
            opacity: 1;
          }
        }
        .animate-slide-up {
          animation: slide-up 0.3s ease-out;
        }
      `}</style>
    </>
  )
}

