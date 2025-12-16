import { createClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import { Sign, Resort, SkiFeature } from '@/lib/utils/types'
import MapPageWrapper from '@/components/game/MapPageWrapper'
import { autoJoinResortIfNeeded } from '@/lib/utils/auto-join-resort'

export default async function MapPage({
  params,
  searchParams,
}: {
  params: Promise<{ 'resort-slug': string }>
  searchParams: Promise<{ sessionId?: string }>
}) {
  const resolvedParams = await params
  const resolvedSearchParams = await searchParams
  const supabase = await createClient()
  
  // Parallel fetch: user auth and resort data (independent queries)
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

  // Automatically join resort if user hasn't joined yet
  // This allows users to access any resort's game, and we track which ones they've played
  await autoJoinResortIfNeeded(resort.id)

  // Parallel fetch: signs, discoveries, and ski features (all depend on resort.id/user.id)
  const [signsResult, discoveriesResult, skiFeaturesResult] = await Promise.all([
    supabase
      .from('signs')
      .select('*')
      .eq('resort_id', resort.id)
      .eq('active', true)
      .order('order_index', { ascending: true }),
    supabase
      .from('user_discoveries')
      .select('sign_id')
      .eq('user_id', user.id),
    supabase
      .from('ski_features')
      .select('id, name, type, difficulty, geometry, status')
      .eq('resort_id', resort.id)
      .eq('active', true)
      .order('order_index', { ascending: true })
  ])

  const signs = signsResult.data
  const discoveries = discoveriesResult.data
  const skiFeatures = skiFeaturesResult.data

  const discoveredSignIds = new Set(discoveries?.map((d) => d.sign_id) || [])

  // Fetch session data if sessionId is provided
  let sessionData = null
  if (resolvedSearchParams.sessionId) {
    const [sessionResult, completionsResult, descentSessionsResult] = await Promise.all([
      supabase
        .from('ski_sessions')
        .select('*')
        .eq('id', resolvedSearchParams.sessionId)
        .eq('user_id', user.id)
        .maybeSingle(),
      supabase
        .from('run_completions')
        .select('*, ski_feature:ski_features(*)')
        .eq('session_id', resolvedSearchParams.sessionId)
        .order('completed_at', { ascending: true }),
      supabase
        .from('descent_sessions')
        .select('*')
        .eq('session_id', resolvedSearchParams.sessionId)
        .order('started_at', { ascending: true })
    ])

    if (sessionResult.data) {
      const completions = completionsResult.data || []
      const descentSessions = descentSessionsResult.data || []
      
      // Group completions by descent session
      const completionsByDescentSession: Record<string, any[]> = {}
      for (const completion of completions) {
        if (completion.descent_session_id) {
          if (!completionsByDescentSession[completion.descent_session_id]) {
            completionsByDescentSession[completion.descent_session_id] = []
          }
          completionsByDescentSession[completion.descent_session_id].push(completion)
        }
      }

      sessionData = {
        session: sessionResult.data,
        completions,
        descentSessions,
        completionsByDescentSession
      }
    }
  }

  return (
    <MapPageWrapper
      resortSlug={resolvedParams['resort-slug']}
      resort={resort as Resort}
      signs={(signs || []) as Sign[]}
      discoveredSignIds={discoveredSignIds}
      skiFeatures={(skiFeatures || []) as SkiFeature[]}
      sessionId={resolvedSearchParams.sessionId || undefined}
      sessionData={sessionData}
    />
  )
}
