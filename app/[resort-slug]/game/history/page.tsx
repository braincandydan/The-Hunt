import { createClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import SessionHistoryClient from './SessionHistoryClient'

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

  // Fetch run completions for each session
  const sessionIds = sessions?.map(s => s.id) || []
  const { data: allCompletions } = sessionIds.length > 0 
    ? await supabase
        .from('run_completions')
        .select(`
          *,
          ski_feature:ski_features(id, name, type, difficulty, geometry)
        `)
        .in('session_id', sessionIds)
        .order('completed_at', { ascending: true })
    : { data: [] }

  // Group completions by session
  const completionsBySession = (allCompletions || []).reduce((acc, completion) => {
    if (!acc[completion.session_id]) {
      acc[completion.session_id] = []
    }
    acc[completion.session_id].push(completion)
    return acc
  }, {} as Record<string, typeof allCompletions>)

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
      sessions={sessions || []}
      completionsBySession={completionsBySession}
      skiFeatures={skiFeatures || []}
    />
  )
}

