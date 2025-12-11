import { createClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import { Sign, Resort, SkiFeature } from '@/lib/utils/types'
import MapPageWrapper from '@/components/game/MapPageWrapper'
import { autoJoinResortIfNeeded } from '@/lib/utils/auto-join-resort'

export default async function MapPage({
  params,
}: {
  params: Promise<{ 'resort-slug': string }>
}) {
  const resolvedParams = await params
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

  return (
    <MapPageWrapper
      resortSlug={resolvedParams['resort-slug']}
      resort={resort as Resort}
      signs={(signs || []) as Sign[]}
      discoveredSignIds={discoveredSignIds}
      skiFeatures={(skiFeatures || []) as SkiFeature[]}
    />
  )
}
