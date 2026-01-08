'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import ErrorBoundary from '@/components/ErrorBoundary'
import SimpleMap3D from '@/components/game/SimpleMap3D'
import { SkiFeature, RunCompletion } from '@/lib/utils/types'

interface SimpleMap3DClientProps {
  resortSlug: string
  resortName: string
  skiFeatures: SkiFeature[]
  userRunCompletions: Array<Pick<RunCompletion, 'id' | 'gps_track' | 'completed_at' | 'ski_feature_id' | 'ski_feature'>>
}

function ErrorFallback() {
  return (
    <div className="fixed inset-0 w-full h-full flex flex-col items-center justify-center bg-gray-900 p-8">
      <div className="text-red-500 mb-4">
        <svg className="w-16 h-16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
      </div>
      <h2 className="text-xl font-bold text-white mb-2">3D Map Error</h2>
      <p className="text-gray-400 text-center mb-4 max-w-md">
        An error occurred while rendering the 3D map. This may be due to invalid coordinate data or WebGL compatibility issues.
      </p>
      <div className="flex gap-4">
        <Link
          href={`/${typeof window !== 'undefined' ? window.location.pathname.split('/')[1] : ''}/game/map`}
          className="px-6 py-2 bg-blue-500 hover:bg-blue-600 text-white font-semibold rounded-lg transition-colors"
        >
          Back to Map
        </Link>
      </div>
    </div>
  )
}

export default function SimpleMap3DClient({
  resortSlug,
  resortName,
  skiFeatures,
  userRunCompletions
}: SimpleMap3DClientProps) {
  const router = useRouter()

  // Debug log
  useEffect(() => {
    console.log('SimpleMap3DClient received:', {
      skiFeaturesCount: skiFeatures.length,
      userRunCompletionsCount: userRunCompletions.length,
      userRunCompletions: userRunCompletions.slice(0, 3) // Log first 3 for debugging
    })
  }, [skiFeatures, userRunCompletions])

  return (
    <div className="fixed inset-0 w-full h-full">
      {/* Header */}
      <header className="absolute top-0 left-0 right-0 z-20 bg-gray-900/80 backdrop-blur-xl border-b border-white/10">
        <div className="px-4 py-4 flex items-center gap-4">
          <Link 
            href={`/${resortSlug}/game/map`}
            className="p-2 rounded-lg hover:bg-white/10 transition-colors"
          >
            <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <div className="flex-1">
            <h1 className="text-xl font-bold text-white">Simple 3D Map</h1>
            <p className="text-sm text-gray-400">{resortName}</p>
          </div>
          <div className="text-sm text-gray-400">
            {skiFeatures.filter(f => f.type === 'trail').length} trails
            {userRunCompletions.length > 0 && (
              <span className="ml-2">• {userRunCompletions.length} logged runs</span>
            )}
          </div>
        </div>
      </header>

      {/* 3D Map with Error Boundary */}
      <div className="absolute inset-0 top-16">
        <ErrorBoundary fallback={<ErrorFallback />}>
          <SimpleMap3D
            skiFeatures={skiFeatures}
            resortName={resortName}
            userRunCompletions={userRunCompletions}
          />
        </ErrorBoundary>
      </div>
    </div>
  )
}

