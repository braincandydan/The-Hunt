import { createClient } from '@/lib/supabase/server'
import { getUserResorts } from '@/lib/utils/user-resorts'
import Link from 'next/link'

export default async function Home() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  // Get all available resorts
  const { data: allResorts } = await supabase
    .from('resorts')
    .select('id, name, slug')
    .order('name', { ascending: true })

  // Get user's resorts if logged in
  const userResorts = user ? await getUserResorts() : []
  const userResortSlugs = new Set(userResorts.map(ur => ur.resort.slug))

  // If user has resorts, prioritize showing them first
  const resorts = allResorts || []

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-900 to-gray-800 flex flex-col">
      {/* Header */}
      <div className="text-center py-12 px-4">
        <h1 className="text-5xl font-bold mb-4 text-white">The Hunt</h1>
        <p className="text-xl text-gray-300">Ski Resort Scavenger Hunt App</p>
      </div>

      {/* Content */}
      <div className="flex-1 px-4 pb-8 max-w-2xl mx-auto w-full">
        {user ? (
          <>
            {/* User's Resorts Section */}
            {userResorts.length > 0 && (
              <div className="mb-8">
                <h2 className="text-2xl font-semibold text-white mb-4">Your Resorts</h2>
                <div className="space-y-3">
                  {userResorts.map((userResort) => (
                    <Link
                      key={userResort.resort.id}
                      href={`/${userResort.resort.slug}/game/map`}
                      className="block bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg p-4 transition-colors shadow-lg"
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <h3 className="text-lg font-semibold">{userResort.resort.name}</h3>
                          {userResort.completed && (
                            <span className="text-sm text-indigo-200">✓ Completed</span>
                          )}
                        </div>
                        <svg
                          className="w-6 h-6"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M9 5l7 7-7 7"
                          />
                        </svg>
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {/* All Resorts Section */}
            {resorts.length > 0 && (
              <div>
                <h2 className="text-2xl font-semibold text-white mb-4">
                  {userResorts.length > 0 ? 'All Resorts' : 'Available Resorts'}
                </h2>
                <div className="space-y-3">
                  {resorts.map((resort) => {
                    const isUserResort = userResortSlugs.has(resort.slug)
                    if (isUserResort) return null // Already shown in "Your Resorts"

                    return (
                      <Link
                        key={resort.id}
                        href={`/${resort.slug}/game/map`}
                        className="block bg-gray-700 hover:bg-gray-600 text-white rounded-lg p-4 transition-colors shadow-lg"
                      >
                        <div className="flex items-center justify-between">
                          <h3 className="text-lg font-semibold">{resort.name}</h3>
                          <svg
                            className="w-6 h-6"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M9 5l7 7-7 7"
                            />
                          </svg>
                        </div>
                      </Link>
                    )
                  })}
                </div>
              </div>
            )}

            {/* No resorts message */}
            {resorts.length === 0 && (
              <div className="text-center py-12">
                <p className="text-gray-400 text-lg">No resorts available yet.</p>
              </div>
            )}
          </>
        ) : (
          <>
            {/* Not logged in - show all resorts with login prompt */}
            {resorts.length > 0 ? (
              <>
                <div className="mb-6 p-4 bg-indigo-900/50 rounded-lg border border-indigo-700">
                  <p className="text-indigo-200 text-center mb-4">
                    Sign in to track your progress and save your discoveries!
                  </p>
                  <Link
                    href="/login"
                    className="block w-full bg-indigo-600 hover:bg-indigo-700 text-white text-center rounded-lg py-3 font-semibold transition-colors"
                  >
                    Sign In / Sign Up
                  </Link>
                </div>

                <h2 className="text-2xl font-semibold text-white mb-4">Available Resorts</h2>
                <div className="space-y-3">
                  {resorts.map((resort) => (
                    <Link
                      key={resort.id}
                      href={`/${resort.slug}/login`}
                      className="block bg-gray-700 hover:bg-gray-600 text-white rounded-lg p-4 transition-colors shadow-lg"
                    >
                      <div className="flex items-center justify-between">
                        <h3 className="text-lg font-semibold">{resort.name}</h3>
                        <svg
                          className="w-6 h-6"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M9 5l7 7-7 7"
                          />
                        </svg>
                      </div>
                    </Link>
                  ))}
                </div>
              </>
            ) : (
              <div className="text-center py-12">
                <p className="text-gray-400 text-lg mb-6">No resorts available yet.</p>
                <Link
                  href="/login"
                  className="inline-block bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg px-6 py-3 font-semibold transition-colors"
                >
                  Sign In / Sign Up
                </Link>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

