import { createClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import SimpleMap3DClient from './SimpleMap3DClient'

export default async function SimpleMap3DPage({
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

  // Fetch ski features for the map
  const { data: skiFeatures } = await supabase
    .from('ski_features')
    .select('id, name, type, difficulty, geometry, resort_id, active, created_at, metadata')
    .eq('resort_id', resort.id)
    .eq('active', true)

  // Fetch user run completions with GPS tracks
  // First get sessions for this user and resort
  const { data: sessions } = await supabase
    .from('ski_sessions')
    .select('id')
    .eq('user_id', user.id)
    .eq('resort_id', resort.id)
    .limit(50) // Get recent 50 sessions

  // Then get run completions from those sessions
  const sessionIds = sessions?.map(s => s.id) || []
  let runCompletions: any[] = []
  
  if (sessionIds.length > 0) {
    const { data, error: runCompletionsError } = await supabase
      .from('run_completions')
      .select(`
        id, 
        gps_track, 
        completed_at, 
        ski_feature_id,
        ski_feature:ski_features(name)
      `)
      .in('session_id', sessionIds)
      .not('gps_track', 'is', null) // Only get runs with GPS tracks
      .order('completed_at', { ascending: false })
      .limit(100) // Limit to most recent 100 runs

    if (runCompletionsError) {
      console.error('Error fetching user run completions:', runCompletionsError)
    } else {
      runCompletions = data || []
      console.log(`Found ${runCompletions.length} user run completions with GPS tracks from ${sessionIds.length} sessions`)
    }
  } else {
    console.log('No sessions found for user at this resort')
  }

  return (
    <SimpleMap3DClient
      resortSlug={resolvedParams['resort-slug']}
      resortName={resort.name}
      skiFeatures={skiFeatures || []}
      userRunCompletions={runCompletions || []}
    />
  )
}

