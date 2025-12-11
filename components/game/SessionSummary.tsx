'use client'

import { useState, useEffect } from 'react'
import { RunProgress } from '@/lib/utils/run-tracking'

interface SessionSummaryProps {
  totalRuns: number
  uniqueRuns: number
  topSpeed: number
  activeRuns: RunProgress[]
  completedRuns: RunProgress[]
  isTracking: boolean
  onToggleExpand?: () => void
  isExpanded?: boolean
  // Wake lock props
  wakeLockSupported?: boolean
  wakeLockActive?: boolean
  keepScreenAwake?: boolean
  onToggleKeepAwake?: () => void
}

// Difficulty badge component
function DifficultyBadge({ difficulty }: { difficulty?: string }) {
  const colors: Record<string, { bg: string; border: string; text: string; icon: string }> = {
    'green': { bg: 'bg-green-500', border: 'border-green-400', text: 'text-white', icon: '●' },
    'blue': { bg: 'bg-blue-500', border: 'border-blue-400', text: 'text-white', icon: '■' },
    'black': { bg: 'bg-black', border: 'border-gray-600', text: 'text-white', icon: '◆' },
    'double-black': { bg: 'bg-black', border: 'border-gray-600', text: 'text-white', icon: '◆◆' },
    'terrain-park': { bg: 'bg-orange-500', border: 'border-orange-400', text: 'text-white', icon: '🎿' }
  }
  
  const style = colors[difficulty || ''] || { bg: 'bg-gray-400', border: 'border-gray-300', text: 'text-white', icon: '○' }
  
  return (
    <span className={`inline-flex items-center justify-center w-5 h-5 rounded-full text-xs font-bold ${style.bg} ${style.text}`}>
      {style.icon}
    </span>
  )
}

// Single run row
function RunRow({ run, index }: { run: RunProgress; index: number }) {
  const duration = run.completedAt 
    ? Math.round((run.completedAt.getTime() - run.startTime.getTime()) / 1000)
    : null
  
  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`
  }
  
  return (
    <div className="flex items-center gap-3 py-2 px-3 bg-white/5 rounded-lg">
      <span className="text-gray-400 text-sm w-6">{index + 1}.</span>
      <DifficultyBadge difficulty={run.difficulty} />
      <span className="flex-1 font-medium truncate">{run.featureName}</span>
      {run.topSpeed > 0 && (
        <span className="text-xs text-gray-400">
          {run.topSpeed.toFixed(0)} km/h
        </span>
      )}
      {duration && (
        <span className="text-xs text-gray-400">
          {formatDuration(duration)}
        </span>
      )}
    </div>
  )
}

// Active run indicator
function ActiveRunIndicator({ run }: { run: RunProgress }) {
  const progressPercent = Math.round((run.currentProgress - run.startProgress) * 100)
  
  return (
    <div className="flex items-center gap-3 py-2 px-3 bg-green-500/20 border border-green-500/30 rounded-lg animate-pulse">
      <div className="w-2 h-2 bg-green-500 rounded-full animate-ping" />
      <DifficultyBadge difficulty={run.difficulty} />
      <span className="flex-1 font-medium truncate">{run.featureName}</span>
      <span className="text-xs text-green-400">
        {progressPercent}% complete
      </span>
    </div>
  )
}

export default function SessionSummary({
  totalRuns,
  uniqueRuns,
  topSpeed,
  activeRuns,
  completedRuns,
  isTracking,
  onToggleExpand,
  isExpanded = false,
  wakeLockSupported = false,
  wakeLockActive = false,
  keepScreenAwake = true,
  onToggleKeepAwake
}: SessionSummaryProps) {
  const [showDetails, setShowDetails] = useState(false)
  
  // Stats display
  const stats = [
    { label: 'Runs', value: totalRuns, icon: '🎿' },
    { label: 'Unique', value: uniqueRuns, icon: '🏔️' },
    { label: 'Top Speed', value: `${topSpeed.toFixed(0)} km/h`, icon: '⚡' }
  ]
  
  // Group completed runs by difficulty for summary
  const runsByDifficulty = completedRuns.reduce((acc, run) => {
    const diff = run.difficulty || 'other'
    acc[diff] = (acc[diff] || 0) + 1
    return acc
  }, {} as Record<string, number>)
  
  return (
    <div className="bg-gradient-to-br from-gray-900/95 to-gray-800/95 backdrop-blur-xl rounded-2xl border border-white/10 shadow-2xl overflow-hidden">
      {/* Header - Always visible */}
      <button
        onClick={() => setShowDetails(!showDetails)}
        className="w-full px-4 py-3 flex items-center justify-between hover:bg-white/5 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className={`w-3 h-3 rounded-full ${isTracking ? 'bg-green-500 animate-pulse' : 'bg-gray-500'}`} />
          <span className="font-semibold text-white">
            {isTracking ? 'Tracking Session' : 'Session Paused'}
          </span>
          {/* Wake lock indicator */}
          {wakeLockActive && (
            <span className="flex items-center gap-1 text-xs text-yellow-400 bg-yellow-500/20 px-2 py-0.5 rounded-full">
              <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"/>
              </svg>
              Awake
            </span>
          )}
        </div>
        
        {/* Quick stats */}
        <div className="flex items-center gap-4 text-sm">
          <span className="text-gray-300">
            <span className="text-white font-bold">{totalRuns}</span> runs
          </span>
          <span className="text-gray-300">
            <span className="text-white font-bold">{topSpeed.toFixed(0)}</span> km/h
          </span>
          <svg 
            className={`w-5 h-5 text-gray-400 transition-transform ${showDetails ? 'rotate-180' : ''}`}
            fill="none" 
            stroke="currentColor" 
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>
      
      {/* Expanded details */}
      {showDetails && (
        <div className="border-t border-white/10">
          {/* Wake Lock Toggle - only show if supported */}
          {wakeLockSupported && onToggleKeepAwake && (
            <div className="px-4 py-3 border-b border-white/10">
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  onToggleKeepAwake()
                }}
                className="w-full flex items-center justify-between"
              >
                <div className="flex items-center gap-3">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                    wakeLockActive ? 'bg-yellow-500/20 text-yellow-400' : 'bg-gray-700 text-gray-400'
                  }`}>
                    {wakeLockActive ? (
                      <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
                      </svg>
                    ) : (
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                      </svg>
                    )}
                  </div>
                  <div className="text-left">
                    <div className="font-medium text-white text-sm">Keep Screen Awake</div>
                    <div className="text-xs text-gray-400">
                      {wakeLockActive ? 'Screen will stay on while tracking' : 'Screen may turn off'}
                    </div>
                  </div>
                </div>
                {/* Toggle Switch */}
                <div className={`w-12 h-6 rounded-full p-1 transition-colors ${
                  keepScreenAwake ? 'bg-green-500' : 'bg-gray-600'
                }`}>
                  <div className={`w-4 h-4 rounded-full bg-white transform transition-transform ${
                    keepScreenAwake ? 'translate-x-6' : 'translate-x-0'
                  }`} />
                </div>
              </button>
            </div>
          )}
          
          {/* Stats grid */}
          <div className="grid grid-cols-3 gap-4 p-4 border-b border-white/10">
            {stats.map(stat => (
              <div key={stat.label} className="text-center">
                <div className="text-2xl mb-1">{stat.icon}</div>
                <div className="text-xl font-bold text-white">{stat.value}</div>
                <div className="text-xs text-gray-400">{stat.label}</div>
              </div>
            ))}
          </div>
          
          {/* Difficulty breakdown */}
          {Object.keys(runsByDifficulty).length > 0 && (
            <div className="px-4 py-3 border-b border-white/10">
              <div className="flex items-center gap-3 flex-wrap">
                {Object.entries(runsByDifficulty).map(([difficulty, count]) => (
                  <div key={difficulty} className="flex items-center gap-1.5">
                    <DifficultyBadge difficulty={difficulty} />
                    <span className="text-sm text-gray-300">×{count}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          
          {/* Active runs */}
          {activeRuns.length > 0 && (
            <div className="p-4 border-b border-white/10">
              <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                Currently Skiing
              </h4>
              <div className="space-y-2">
                {activeRuns.map(run => (
                  <ActiveRunIndicator key={run.featureId} run={run} />
                ))}
              </div>
            </div>
          )}
          
          {/* Completed runs list */}
          {completedRuns.length > 0 && (
            <div className="p-4 max-h-64 overflow-y-auto">
              <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                Completed Runs
              </h4>
              <div className="space-y-2">
                {[...completedRuns].reverse().map((run, i) => (
                  <RunRow key={`${run.featureId}-${i}`} run={run} index={completedRuns.length - i} />
                ))}
              </div>
            </div>
          )}
          
          {completedRuns.length === 0 && activeRuns.length === 0 && (
            <div className="p-8 text-center">
              <div className="text-4xl mb-3">🎿</div>
              <p className="text-gray-400">
                Start skiing to track your runs!
              </p>
              <p className="text-sm text-gray-500 mt-1">
                We'll automatically detect when you complete a run
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

