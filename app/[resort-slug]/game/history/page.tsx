import { createClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import SessionHistoryClient from './SessionHistoryClient'
import { RunCompletion } from '@/lib/utils/types'

export default async function SessionHistoryPage({
  params,
}: {
  params: Promise<{ 'resort-slug': string }>
}) {
  const resolvedParams = await params
  const supabase = await createClient()
  
  // Check auth and get resort
  const [userResult, resortResult] = await Promise.all([
    supabase.auth.getUser(),
    supabase
      .from('resorts')
      .select('*')
      .eq('slug', resolvedParams['resort-slug'])
      .maybeSingle()
  ])

  const user = userResult.data?.user
  const { data: resort, error: resortError } = resortResult

  if (!user) {
    redirect(`/${resolvedParams['resort-slug']}/login`)
  }

  if (resortError || !resort) {
    notFound()
  }

  // Fetch all sessions for this user at this resort
  const { data: sessions } = await supabase
    .from('ski_sessions')
    .select('*')
    .eq('user_id', user.id)
    .eq('resort_id', resort.id)
    .order('session_date', { ascending: false })
    .limit(30)

  // Fetch run completions and descent sessions for each session
  const sessionIds = sessions?.map(s => s.id) || []
  const [allCompletionsResult, locationHistoryResult, descentSessionsResult] = await Promise.all([
    sessionIds.length > 0 
      ? supabase
          .from('run_completions')
          .select(`
            *,
            ski_feature:ski_features(id, name, type, difficulty, geometry)
          `)
          .in('session_id', sessionIds)
          .order('completed_at', { ascending: true })
      : { data: [], error: null },
    sessionIds.length > 0
      ? supabase
          .from('location_history')
          .select('session_id')
          .in('session_id', sessionIds)
          // Use a higher limit or get distinct session IDs to ensure we catch all sessions
          // Since we're just checking existence, we can use a larger limit
          .limit(10000)
      : { data: [], error: null },
    sessionIds.length > 0
      ? supabase
          .from('descent_sessions')
          .select('*')
          .in('session_id', sessionIds)
          .order('started_at', { ascending: false })
      : { data: [], error: null }
  ])

  const { data: allCompletions } = allCompletionsResult
  const { data: locationHistory } = locationHistoryResult
  const { data: descentSessions } = descentSessionsResult

  // Group completions by session
  const completionsBySession = (allCompletions || []).reduce((acc, completion) => {
    if (!acc[completion.session_id]) {
      acc[completion.session_id] = []
    }
    acc[completion.session_id].push(completion)
    return acc
  }, {} as Record<string, typeof allCompletions>)

  // Group descent sessions by session_id
  const descentSessionsBySession = (descentSessions || []).reduce((acc, descent) => {
    if (!acc[descent.session_id]) {
      acc[descent.session_id] = []
    }
    acc[descent.session_id].push(descent)
    return acc
  }, {} as Record<string, typeof descentSessions>)

  // Group completions by descent session and sort by sequence order
  const completionsByDescentSession = (allCompletions || []).reduce((acc, completion) => {
    if (completion.descent_session_id) {
      if (!acc[completion.descent_session_id]) {
        acc[completion.descent_session_id] = []
      }
      acc[completion.descent_session_id].push(completion)
    }
    return acc
  }, {} as Record<string, typeof allCompletions>)

  // Sort completions within each descent session by sequence_order
  Object.keys(completionsByDescentSession).forEach(descentId => {
    completionsByDescentSession[descentId].sort((a: RunCompletion, b: RunCompletion) => {
      const orderA = a.sequence_order ?? 999999
      const orderB = b.sequence_order ?? 999999
      return orderA - orderB
    })
  })

  // Get unique session IDs that have location history
  const sessionsWithLocationHistory = new Set(
    (locationHistory || []).map(lh => lh.session_id)
  )

  // Filter sessions to only include those with tracked data
  // A session has tracked data if it has:
  // 1. Run completions, OR
  // 2. Location history (GPS tracking)
  const sessionsWithData = (sessions || []).filter(session => {
    const hasCompletions = (completionsBySession[session.id]?.length || 0) > 0
    const hasLocationHistory = sessionsWithLocationHistory.has(session.id)
    return hasCompletions || hasLocationHistory
  })

  // Fetch ski features for the map
  const { data: skiFeatures } = await supabase
    .from('ski_features')
    .select('id, name, type, difficulty, geometry, resort_id, active, created_at')
    .eq('resort_id', resort.id)
    .eq('active', true)

  return (
    <SessionHistoryClient
      resortSlug={resolvedParams['resort-slug']}
      resortName={resort.name}
      sessions={sessionsWithData}
      completionsBySession={completionsBySession}
      descentSessionsBySession={descentSessionsBySession}
      completionsByDescentSession={completionsByDescentSession}
      skiFeatures={skiFeatures || []}
    />
  )
}



