import { createClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import { Sign } from '@/lib/utils/types'
import Link from 'next/link'

export default async function GamePage({
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
  const foundCount = discoveredSignIds.size
  const totalCount = signs?.length || 0

  return (
    <div className="min-h-screen bg-gray-50 p-4">
      <div className="max-w-4xl mx-auto">
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <h1 className="text-3xl font-bold mb-2">{resort.name}</h1>
          <p className="text-gray-600 mb-4">
            Find all the signs around the mountain!
          </p>
          <div className="mb-4">
            <div className="flex justify-between text-sm mb-1">
              <span>Progress</span>
              <span>{foundCount} / {totalCount}</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-4">
              <div
                className="bg-indigo-600 h-4 rounded-full transition-all"
                style={{ width: `${totalCount > 0 ? (foundCount / totalCount) * 100 : 0}%` }}
              />
            </div>
          </div>
        </div>

        {signs && signs.length > 0 ? (
          <div className="grid gap-4">
            {signs.map((sign: Sign) => {
              const isFound = discoveredSignIds.has(sign.id)
              return (
                <Link
                  key={sign.id}
                  href={`/${resolvedParams['resort-slug']}/game/sign/${sign.id}`}
                  className={`block bg-white rounded-lg shadow p-4 hover:shadow-md transition ${
                    isFound ? 'border-l-4 border-green-500' : ''
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-semibold text-lg">{sign.name}</h3>
                      {sign.description && (
                        <p className="text-gray-600 text-sm mt-1">{sign.description}</p>
                      )}
                    </div>
                    <div className="flex items-center space-x-2">
                      {isFound ? (
                        <span className="text-green-600 font-semibold">✓ Found</span>
                      ) : (
                        <span className="text-gray-400">Not found</span>
                      )}
                    </div>
                  </div>
                </Link>
              )
            })}
          </div>
        ) : (
          <div className="bg-white rounded-lg shadow p-6 text-center">
            <p className="text-gray-600">No signs yet. Check back soon!</p>
            <p className="text-sm text-gray-500 mt-2">
              Admins can add signs from the admin panel.
            </p>
          </div>
        )}

        <div className="mt-6 flex space-x-4">
          <Link
            href={`/${resolvedParams['resort-slug']}/game/map`}
            className="flex-1 bg-indigo-600 text-white text-center py-3 rounded-lg font-semibold hover:bg-indigo-700 transition"
          >
            View Map
          </Link>
        </div>
      </div>
    </div>
  )
}
