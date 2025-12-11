import Image from 'next/image'
import { createClient } from '@/lib/supabase/server'
import { notFound, redirect } from 'next/navigation'
import { Sign } from '@/lib/utils/types'
import Link from 'next/link'
import LazyQRScanner from '@/components/game/LazyQRScanner'

export default async function SignDetailPage({
  params,
}: {
  params: Promise<{ 'resort-slug': string; id: string }>
}) {
  const resolvedParams = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect(`/${resolvedParams['resort-slug']}/login`)
  }

  const { data: sign, error } = await supabase
    .from('signs')
    .select('*')
    .eq('id', resolvedParams.id)
    .single()

  if (error || !sign) {
    notFound()
  }

  // Check if user has discovered this sign
  const { data: discovery } = await supabase
    .from('user_discoveries')
    .select('*')
    .eq('user_id', user.id)
    .eq('sign_id', resolvedParams.id)
    .single()

  const isFound = !!discovery

  return (
    <div className="min-h-screen bg-gray-50 p-4">
      <div className="max-w-2xl mx-auto">
        <Link
          href={`/${resolvedParams['resort-slug']}/game`}
          className="text-indigo-600 hover:text-indigo-800 mb-4 inline-block"
        >
          ← Back to signs
        </Link>

        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <h1 className="text-3xl font-bold mb-2">{sign.name}</h1>
          
          {sign.description && (
            <p className="text-gray-600 mb-4">{sign.description}</p>
          )}

          {sign.hint && (
            <div className="bg-yellow-50 border border-yellow-200 rounded p-4 mb-4">
              <h3 className="font-semibold text-yellow-800 mb-1">Hint:</h3>
              <p className="text-yellow-700">{sign.hint}</p>
            </div>
          )}

          {sign.photo_url && (
            <div className="mb-4 relative w-full aspect-video">
              <Image
                src={sign.photo_url}
                alt={sign.name}
                fill
                className="rounded-lg object-cover"
                unoptimized
              />
            </div>
          )}

          {isFound && (
            <div className="bg-green-50 border border-green-200 rounded p-4 mb-4">
              <p className="text-green-800 font-semibold">✓ You found this sign!</p>
              <p className="text-green-700 text-sm mt-1">
                Found on {new Date(discovery.discovered_at).toLocaleDateString()}
              </p>
            </div>
          )}
        </div>

        {!isFound && (
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-xl font-bold mb-4">Scan QR Code</h2>
            <LazyQRScanner resortSlug={resolvedParams['resort-slug']} signId={resolvedParams.id} />
          </div>
        )}
      </div>
    </div>
  )
}

