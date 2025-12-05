import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { Sign } from '@/lib/utils/types'
import MapView from '@/components/game/MapView'

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
    redirect('/login')
  }

  // Get resort
  const { data: resort } = await supabase
    .from('resorts')
    .select('*')
    .eq('slug', resolvedParams['resort-slug'])
    .single()

  // Get signs
  const { data: signs } = await supabase
    .from('signs')
    .select('*')
    .eq('resort_id', resort?.id)
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
    .eq('resort_id', resort?.id)
    .eq('active', true)
    .order('order_index', { ascending: true })

  return (
    <div className="fixed inset-0 w-full h-full">
      <MapView
        resortSlug={resolvedParams['resort-slug']}
        signs={signs || []}
        discoveredSignIds={discoveredSignIds}
        skiFeatures={skiFeatures || []}
        resortName={resort?.name || 'Resort'}
      />
    </div>
  )
}
