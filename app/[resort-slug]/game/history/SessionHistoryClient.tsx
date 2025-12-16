'use client'

import { useState, useEffect, useRef, useMemo } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { SkiSession, RunCompletion, SkiFeature, DescentSession } from '@/lib/utils/types'

interface SessionHistoryClientProps {
  resortSlug: string
  resortName: string
  sessions: SkiSession[]
  completionsBySession: Record<string, RunCompletion[]>
  descentSessionsBySession: Record<string, DescentSession[]>
  completionsByDescentSession: Record<string, RunCompletion[]>
  skiFeatures: SkiFeature[]
}

// Format date nicely
function formatDate(dateStr: string): string {
  const date = new Date(dateStr)
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function formatTime(dateStr: string): string {
  const date = new Date(dateStr)
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${mins}:${String(secs).padStart(2, '0')}`
}

// Difficulty badge
function DifficultyBadge({ difficulty, size = 'sm' }: { difficulty?: string; size?: 'sm' | 'md' }) {
  const colors: Record<string, string> = {
    'green': 'bg-green-500',
    'blue': 'bg-blue-500',
    'black': 'bg-gray-900',
    'double-black': 'bg-gray-900',
    'terrain-park': 'bg-orange-500'
  }
  
  const icons: Record<string, string> = {
    'green': '●',
    'blue': '■',
    'black': '◆',
    'double-black': '◆◆',
    'terrain-park': '🎿'
  }
  
  const sizeClass = size === 'md' ? 'w-6 h-6 text-sm' : 'w-4 h-4 text-xs'
  
  return (
    <span className={`inline-flex items-center justify-center rounded-full text-white font-bold ${sizeClass} ${colors[difficulty || ''] || 'bg-gray-400'}`}>
      {icons[difficulty || ''] || '○'}
    </span>
  )
}


// Session card component - simplified to be a clickable card
function SessionCard({ 
  session, 
  completions,
  descentSessions,
  skiFeatures,
  resortSlug
}: { 
  session: SkiSession
  completions: RunCompletion[]
  descentSessions: DescentSession[]
  skiFeatures: SkiFeature[]
  resortSlug: string
}) {
  const router = useRouter()
  const supabaseRef = useRef(createClient())
  const supabase = supabaseRef.current
  
  // Get unique runs
  const uniqueRunIds = useMemo(() => new Set(completions.map(c => c.ski_feature_id)), [completions])
  
  // Count by difficulty
  const byDifficulty = completions.reduce((acc, c) => {
    const feature = skiFeatures.find(f => f.id === c.ski_feature_id)
    const diff = feature?.difficulty || 'other'
    acc[diff] = (acc[diff] || 0) + 1
    return acc
  }, {} as Record<string, number>)
  
  // Fetch basic metrics for display
  const [calculatedMetrics, setCalculatedMetrics] = useState<{ topSpeed: number; avgSpeed: number; verticalMeters: number } | null>(null)
  const [routeLoading, setRouteLoading] = useState(false)
  
  useEffect(() => {
    if (calculatedMetrics !== null || routeLoading) return
    
    const fetchMetrics = async () => {
      setRouteLoading(true)
      try {
        const { data: locations, error } = await supabase
          .from('location_history')
          .select('speed_kmh, altitude_meters')
          .eq('session_id', session.id)
          .order('recorded_at', { ascending: true })
        
        if (!error && locations && locations.length > 0) {
          const speeds = locations
            .map(l => l.speed_kmh)
            .filter((s): s is number => s !== null && s !== undefined && s > 0)
          
          const topSpeed = speeds.length > 0 ? Math.max(...speeds) : 0
          const avgSpeed = speeds.length > 0 ? speeds.reduce((a, b) => a + b, 0) / speeds.length : 0
          
          // Calculate vertical meters (sum of altitude drops)
          let verticalMeters = 0
          for (let i = 1; i < locations.length; i++) {
            const prev = locations[i - 1].altitude_meters
            const curr = locations[i].altitude_meters
            if (prev !== null && prev !== undefined && curr !== null && curr !== undefined && prev > curr) {
              verticalMeters += prev - curr
            }
          }
          
          setCalculatedMetrics({ topSpeed, avgSpeed, verticalMeters })
        }
      } catch (err) {
        console.warn('Error fetching metrics:', err)
      } finally {
        setRouteLoading(false)
      }
    }
    
    fetchMetrics()
  }, [session.id, calculatedMetrics, routeLoading, supabase])

  // Use calculated metrics from location_history if available, otherwise use session data
  const topSpeed = calculatedMetrics?.topSpeed || session.top_speed_kmh || 0
  const avgSpeed = calculatedMetrics?.avgSpeed || session.avg_speed_kmh || 0
  const verticalMeters = calculatedMetrics?.verticalMeters || session.total_vertical_meters || 0

  const handleClick = () => {
    router.push(`/${resortSlug}/game/map?sessionId=${session.id}`)
  }

  return (
    <button
      onClick={handleClick}
      className="w-full bg-gray-800/50 rounded-xl border border-white/10 overflow-hidden hover:bg-white/5 transition-colors text-left"
    >
      <div className="px-4 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="text-left">
            <div className="font-semibold text-white text-lg">
              {formatDate(session.session_date)}
            </div>
            <div className="text-sm text-gray-400">
              {completions.length > 0 ? (
                <>
                  {completions.length} runs • {uniqueRunIds.size} unique
                  {descentSessions.length > 0 && ` • ${descentSessions.length} descents`}
                </>
              ) : (
                'No tracked data'
              )}
            </div>
          </div>
        </div>
        
        <div className="flex items-center gap-4">
          {/* Difficulty pills */}
          <div className="hidden sm:flex items-center gap-2">
            {Object.entries(byDifficulty).map(([diff, count]) => (
              <div key={diff} className="flex items-center gap-1 bg-white/10 rounded-full px-2 py-1">
                <DifficultyBadge difficulty={diff} />
                <span className="text-xs text-gray-300">×{count}</span>
              </div>
            ))}
          </div>
          
          {/* Speed and elevation metrics */}
          <div className="flex items-center gap-4 text-right">
            {/* Top speed */}
            {(topSpeed > 0 || avgSpeed > 0 || completions.length > 0) && (
              <div>
                <div className="text-sm font-bold text-white">
                  {topSpeed > 0 ? topSpeed.toFixed(0) : '—'}
                </div>
                <div className="text-xs text-gray-400">Top km/h</div>
              </div>
            )}
            
            {/* Average speed */}
            {avgSpeed > 0 && (
              <div>
                <div className="text-sm font-bold text-white">{avgSpeed.toFixed(1)}</div>
                <div className="text-xs text-gray-400">Avg km/h</div>
              </div>
            )}
            
            {/* Vertical meters */}
            {verticalMeters > 0 && (
              <div>
                <div className="text-sm font-bold text-white">{verticalMeters.toFixed(0)}</div>
                <div className="text-xs text-gray-400">Vertical m</div>
              </div>
            )}
          </div>
          
          <svg 
            className="w-5 h-5 text-gray-400"
            fill="none" 
            stroke="currentColor" 
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </div>
      </div>
    </button>
  )
}

export default function SessionHistoryClient({
  resortSlug,
  resortName,
  sessions,
  completionsBySession,
  descentSessionsBySession,
  completionsByDescentSession,
  skiFeatures
}: SessionHistoryClientProps) {

  const router = useRouter()
  
  const handleRefresh = () => {
    window.location.reload()
  }
  
  // Calculate totals
  const totalRuns = sessions.reduce((sum, s) => sum + s.total_runs, 0)
  const allCompletions = Object.values(completionsBySession).flat()
  const uniqueRunIds = new Set(allCompletions.map(c => c.ski_feature_id))
  const topSpeed = Math.max(...sessions.map(s => s.top_speed_kmh || 0), 0)
  
  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-slate-900 to-gray-900">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-gray-900/80 backdrop-blur-xl border-b border-white/10">
        <div className="max-w-2xl mx-auto px-4 py-4 flex items-center gap-4">
          <Link 
            href={`/${resortSlug}/game/map`}
            className="p-2 rounded-lg hover:bg-white/10 transition-colors"
          >
            <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <div className="flex-1">
            <h1 className="text-xl font-bold text-white">Session History</h1>
            <p className="text-sm text-gray-400">{resortName}</p>
          </div>
          <button
            onClick={handleRefresh}
            className="p-2 rounded-lg hover:bg-white/10 transition-colors"
            aria-label="Refresh page"
          >
            <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
        </div>
      </header>
      
      <main className="max-w-2xl mx-auto px-4 py-6">
        {/* Stats overview */}
        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="bg-gradient-to-br from-blue-500/20 to-blue-600/10 rounded-xl p-4 border border-blue-500/20">
            <div className="text-3xl font-bold text-white">{sessions.length}</div>
            <div className="text-sm text-blue-300">Sessions</div>
          </div>
          <div className="bg-gradient-to-br from-green-500/20 to-green-600/10 rounded-xl p-4 border border-green-500/20">
            <div className="text-3xl font-bold text-white">{totalRuns}</div>
            <div className="text-sm text-green-300">Total Runs</div>
          </div>
          <div className="bg-gradient-to-br from-orange-500/20 to-orange-600/10 rounded-xl p-4 border border-orange-500/20">
            <div className="text-3xl font-bold text-white">{topSpeed.toFixed(0)}</div>
            <div className="text-sm text-orange-300">Top km/h</div>
          </div>
        </div>
        
        {/* Unique runs badge */}
        {uniqueRunIds.size > 0 && (
          <div className="mb-6 p-4 bg-gradient-to-r from-purple-500/10 to-pink-500/10 rounded-xl border border-purple-500/20">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm text-gray-400">Runs Explored</div>
                <div className="text-2xl font-bold text-white">
                  {uniqueRunIds.size} / {skiFeatures.filter(f => f.type === 'trail').length}
                </div>
              </div>
              <div className="text-right">
                <div className="text-sm text-gray-400">Completion</div>
                <div className="text-2xl font-bold text-purple-400">
                  {Math.round((uniqueRunIds.size / Math.max(1, skiFeatures.filter(f => f.type === 'trail').length)) * 100)}%
                </div>
              </div>
            </div>
            {/* Progress bar */}
            <div className="mt-3 h-2 bg-gray-700 rounded-full overflow-hidden">
              <div 
                className="h-full bg-gradient-to-r from-purple-500 to-pink-500 transition-all duration-500"
                style={{ 
                  width: `${(uniqueRunIds.size / Math.max(1, skiFeatures.filter(f => f.type === 'trail').length)) * 100}%` 
                }}
              />
            </div>
          </div>
        )}
        
        {/* Session list */}
        <div className="space-y-4">
          <h2 className="text-lg font-semibold text-white">Past Sessions</h2>
          
          {sessions.length === 0 ? (
            <div className="text-center py-12">
              <div className="text-6xl mb-4">🎿</div>
              <h3 className="text-xl font-semibold text-white mb-2">No sessions yet</h3>
              <p className="text-gray-400 mb-6">
                Start skiing with location tracking enabled to record your runs!
              </p>
              <Link
                href={`/${resortSlug}/game/map`}
                className="inline-flex items-center gap-2 px-6 py-3 bg-blue-500 hover:bg-blue-600 text-white font-semibold rounded-xl transition-colors"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
                </svg>
                Open Map
              </Link>
            </div>
          ) : (
            sessions.map(session => (
              <SessionCard
                key={session.id}
                session={session}
                completions={completionsBySession[session.id] || []}
                descentSessions={descentSessionsBySession[session.id] || []}
                skiFeatures={skiFeatures}
                resortSlug={resortSlug}
              />
            ))
          )}
        </div>
      </main>
    </div>
  )
}



