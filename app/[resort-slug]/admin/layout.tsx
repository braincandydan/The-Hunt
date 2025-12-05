import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { isAdmin, isResortAdmin } from '@/lib/utils/admin'

export default async function AdminLayout({
  children,
  params,
}: {
  children: React.ReactNode
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

  // Get resort to check permissions
  const { data: resort } = await supabase
    .from('resorts')
    .select('id')
    .eq('slug', resolvedParams['resort-slug'])
    .single()

  // Check if user is admin
  const userIsAdmin = await isAdmin()
  const userIsResortAdmin = resort?.id ? await isResortAdmin(resort.id) : false

  // Only allow admins to access admin panel
  if (!userIsAdmin && !userIsResortAdmin) {
    redirect(`/${resolvedParams['resort-slug']}/game`)
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white shadow">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex">
              <Link
                href={`/${resolvedParams['resort-slug']}/admin`}
                className="inline-flex items-center px-4 py-2 border-b-2 border-transparent text-sm font-medium leading-5 text-gray-500 hover:text-gray-700 hover:border-gray-300 focus:outline-none focus:text-gray-700 focus:border-gray-300 transition"
              >
                Dashboard
              </Link>
              <Link
                href={`/${resolvedParams['resort-slug']}/admin/signs`}
                className="inline-flex items-center px-4 py-2 border-b-2 border-transparent text-sm font-medium leading-5 text-gray-500 hover:text-gray-700 hover:border-gray-300 focus:outline-none focus:text-gray-700 focus:border-gray-300 transition"
              >
                Signs
              </Link>
              <Link
                href={`/${resolvedParams['resort-slug']}/admin/settings`}
                className="inline-flex items-center px-4 py-2 border-b-2 border-transparent text-sm font-medium leading-5 text-gray-500 hover:text-gray-700 hover:border-gray-300 focus:outline-none focus:text-gray-700 focus:border-gray-300 transition"
              >
                Settings
              </Link>
            </div>
            <div className="flex items-center space-x-4">
              {userIsAdmin && (
                <span className="text-xs text-indigo-600 bg-indigo-50 px-2 py-1 rounded">
                  Super Admin
                </span>
              )}
              <Link
                href={`/${resolvedParams['resort-slug']}/game`}
                className="text-sm text-gray-600 hover:text-gray-900"
              >
                View Game
              </Link>
            </div>
          </div>
        </div>
      </nav>
      <main className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        {children}
      </main>
    </div>
  )
}
