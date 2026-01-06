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

  return (
    <SimpleMap3DClient
      resortSlug={resolvedParams['resort-slug']}
      resortName={resort.name}
      skiFeatures={skiFeatures || []}
    />
  )
}

