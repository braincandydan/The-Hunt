import { createClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'

export default async function AdminDashboard({
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

  // Get resort - must exist to proceed
  const { data: resort, error: resortError } = await supabase
    .from('resorts')
    .select('*')
    .eq('slug', resolvedParams['resort-slug'])
    .single()

  // Guard clause: Resort must exist before we query stats
  if (resortError || !resort) {
    notFound()
  }

  // Get stats - now safe to use resort.id
  const { count: signsCount } = await supabase
    .from('signs')
    .select('*', { count: 'exact', head: true })
    .eq('resort_id', resort.id)

  // Get sign IDs for this resort to filter discoveries
  const { data: resortSigns } = await supabase
    .from('signs')
    .select('id')
    .eq('resort_id', resort.id)

  const signIds = resortSigns?.map(s => s.id) || []

  // Count discoveries only for this resort's signs
  const { count: discoveriesCount } = signIds.length > 0
    ? await supabase
        .from('user_discoveries')
        .select('*', { count: 'exact', head: true })
        .in('sign_id', signIds)
    : { count: 0 }

  const { count: usersCount } = await supabase
    .from('user_metadata')
    .select('*', { count: 'exact', head: true })
    .eq('resort_id', resort.id)

  return (
    <div className="px-4 py-6 sm:px-0">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">Admin Dashboard</h1>
        <p className="mt-2 text-gray-600">{resort?.name}</p>
      </div>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
        <div className="bg-white overflow-hidden shadow rounded-lg">
          <div className="p-5">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <div className="w-8 h-8 bg-indigo-500 rounded-md flex items-center justify-center">
                  <span className="text-white font-bold">📋</span>
                </div>
              </div>
              <div className="ml-5 w-0 flex-1">
                <dl>
                  <dt className="text-sm font-medium text-gray-500 truncate">Total Signs</dt>
                  <dd className="text-lg font-semibold text-gray-900">{signsCount || 0}</dd>
                </dl>
              </div>
            </div>
          </div>
          <div className="bg-gray-50 px-5 py-3">
            <div className="text-sm">
              <Link
                href={`/${resolvedParams['resort-slug']}/admin/signs`}
                className="font-medium text-indigo-700 hover:text-indigo-900"
              >
                Manage signs
              </Link>
            </div>
          </div>
        </div>

        <div className="bg-white overflow-hidden shadow rounded-lg">
          <div className="p-5">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <div className="w-8 h-8 bg-green-500 rounded-md flex items-center justify-center">
                  <span className="text-white font-bold">✓</span>
                </div>
              </div>
              <div className="ml-5 w-0 flex-1">
                <dl>
                  <dt className="text-sm font-medium text-gray-500 truncate">Discoveries</dt>
                  <dd className="text-lg font-semibold text-gray-900">{discoveriesCount || 0}</dd>
                </dl>
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white overflow-hidden shadow rounded-lg">
          <div className="p-5">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <div className="w-8 h-8 bg-blue-500 rounded-md flex items-center justify-center">
                  <span className="text-white font-bold">👥</span>
                </div>
              </div>
              <div className="ml-5 w-0 flex-1">
                <dl>
                  <dt className="text-sm font-medium text-gray-500 truncate">Users</dt>
                  <dd className="text-lg font-semibold text-gray-900">{usersCount || 0}</dd>
                </dl>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-8">
        <div className="bg-white shadow rounded-lg p-6">
          <h2 className="text-xl font-bold mb-4">Quick Actions</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Link
              href={`/${resolvedParams['resort-slug']}/admin/signs/new`}
              className="block p-4 border-2 border-dashed border-gray-300 rounded-lg text-center hover:border-indigo-500 hover:bg-indigo-50 transition"
            >
              <div className="text-2xl mb-2">➕</div>
              <div className="font-semibold">Add New Sign</div>
            </Link>
            <Link
              href={`/${resolvedParams['resort-slug']}/admin/settings`}
              className="block p-4 border-2 border-dashed border-gray-300 rounded-lg text-center hover:border-indigo-500 hover:bg-indigo-50 transition"
            >
              <div className="text-2xl mb-2">⚙️</div>
              <div className="font-semibold">Customize Theme</div>
            </Link>
            <Link
              href={`/${resolvedParams['resort-slug']}/game`}
              className="block p-4 border-2 border-dashed border-gray-300 rounded-lg text-center hover:border-indigo-500 hover:bg-indigo-50 transition"
            >
              <div className="text-2xl mb-2">👁️</div>
              <div className="font-semibold">Preview Game</div>
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}

