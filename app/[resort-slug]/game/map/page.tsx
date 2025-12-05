import { createClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import { Sign, Resort, SkiFeature } from '@/lib/utils/types'
import MapPageWrapper from '@/components/game/MapPageWrapper'

export default async function MapPage({
  params,
}: {
  params: Promise<{ 'resort-slug': string }>
}) {
  const resolvedParams = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect(`/${resolvedParams['resort-slug']}/login`)
  }

  // Get resort
  const { data: resort, error: resortError } = await supabase
    .from('resorts')
    .select('*')
    .eq('slug', resolvedParams['resort-slug'])
    .maybeSingle()

  if (resortError) {
    console.error('Resort query error:', resortError.message || resortError)
    notFound()
  }

  if (!resort) {
    notFound()
  }

  // Get signs
  const { data: signs } = await supabase
    .from('signs')
    .select('*')
    .eq('resort_id', resort.id)
    .eq('active', true)
    .order('order_index', { ascending: true })

  // Get user discoveries
  const { data: discoveries } = await supabase
    .from('user_discoveries')
    .select('sign_id')
    .eq('user_id', user.id)

  const discoveredSignIds = new Set(discoveries?.map((d) => d.sign_id) || [])

  // Get ski features (trails, lifts, boundaries)
  const { data: skiFeatures } = await supabase
    .from('ski_features')
    .select('id, name, type, difficulty, geometry, status')
    .eq('resort_id', resort.id)
    .eq('active', true)
    .order('order_index', { ascending: true })

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
