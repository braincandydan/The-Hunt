'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter, usePathname } from 'next/navigation'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [resortSlug, setResortSlug] = useState<string | null>(null)
  const router = useRouter()
  const pathname = usePathname()
  // Create Supabase client once using useMemo to prevent recreation on each render
  const supabase = useMemo(() => createClient(), [])

  // Extract resort slug from URL if present (e.g., /vail-resort/login)
  useEffect(() => {
    const pathMatch = pathname.match(/^\/([^/]+)\/login$/)
    if (pathMatch) {
      setResortSlug(pathMatch[1])
    }
  }, [pathname])

  const getRedirectPath = () => {
    if (resortSlug) {
      return `/${resortSlug}/game/map`
    }
    return '/'
  }

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    try {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      })

      if (error) throw error

      router.push(getRedirectPath())
      router.refresh()
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'An error occurred'
      setError(message)
    } finally {
      setLoading(false)
    }
  }

  const handleSignUp = async () => {
    setLoading(true)
    setError(null)

    try {
      // Prepare state parameter with resort slug for callback
      const state = resortSlug ? JSON.stringify({ resortSlug }) : undefined
      const redirectTo = resortSlug 
        ? `${window.location.origin}/auth/callback?state=${encodeURIComponent(state || '')}`
        : `${window.location.origin}/auth/callback`

      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: redirectTo,
          data: {
            resort_slug: resortSlug, // Store in user metadata if needed
          },
        },
      })

      if (error) throw error

      // If we have a resort slug, associate user with resort
      if (resortSlug && data.user) {
        // Get resort ID
        const { data: resort } = await supabase
          .from('resorts')
          .select('id')
          .eq('slug', resortSlug)
          .single()

        if (resort) {
          // Add user to user_resorts table (tracks which resorts user has joined)
          await supabase
            .from('user_resorts')
            .insert({
              user_id: data.user.id,
              resort_id: resort.id,
            })
            // Use upsert to avoid errors if already exists
            .select()
            .single()

          // Also set as primary resort in user_metadata (for backward compatibility)
          await supabase
            .from('user_metadata')
            .upsert({
              id: data.user.id,
              resort_id: resort.id, // Primary/home resort
            })
        }
      }

      setSuccessMessage('Check your email for the confirmation link!')
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'An error occurred'
      setError(message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="max-w-md w-full space-y-8 p-8 bg-white rounded-lg shadow">
        <div>
          <h2 className="text-center text-3xl font-bold">Sign in</h2>
          <p className="mt-2 text-center text-sm text-gray-600">
            Or create a new account
          </p>
        </div>
        <form className="mt-8 space-y-6" onSubmit={handleLogin}>
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
              {error}
            </div>
          )}
          {successMessage && (
            <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded">
              {successMessage}
            </div>
          )}
          <div className="space-y-4">
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-700">
                Email address
              </label>
              <input
                id="email"
                name="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
                placeholder="Email"
              />
            </div>
            <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-700">
                Password
              </label>
              <input
                id="password"
                name="password"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
                placeholder="Password"
              />
            </div>
          </div>

          <div className="flex flex-col space-y-2">
            <button
              type="submit"
              disabled={loading}
              className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50"
            >
              {loading ? 'Loading...' : 'Sign in'}
            </button>
            <button
              type="button"
              onClick={handleSignUp}
              disabled={loading}
              className="w-full flex justify-center py-2 px-4 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50"
            >
              Sign up
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
