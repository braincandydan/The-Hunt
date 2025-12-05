import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET(request: Request) {
  const requestUrl = new URL(request.url)
  const code = requestUrl.searchParams.get('code')
  const origin = requestUrl.origin

  if (code) {
    const supabase = await createClient()
    await supabase.auth.exchangeCodeForSession(code)
  }

  // Try to get resort slug from referrer or state parameter
  const referer = request.headers.get('referer') || ''
  const state = requestUrl.searchParams.get('state')
  
  // Extract resort slug from referer URL (e.g., /vail-resort/login)
  let resortSlug: string | null = null
  if (referer) {
    const refererUrl = new URL(referer)
    const pathMatch = refererUrl.pathname.match(/^\/([^/]+)/)
    if (pathMatch && pathMatch[1] !== 'login' && pathMatch[1] !== 'auth') {
      resortSlug = pathMatch[1]
    }
  }
  
  // If state parameter contains resort slug, use that
  if (state) {
    try {
      const stateData = JSON.parse(decodeURIComponent(state))
      if (stateData.resortSlug) {
        resortSlug = stateData.resortSlug
      }
    } catch {
      // If state is not JSON, treat it as resort slug directly
      if (state && !state.includes('{')) {
        resortSlug = state
      }
    }
  }

  // Redirect to resort game map if we have a slug, otherwise root
  if (resortSlug) {
    return NextResponse.redirect(`${origin}/${resortSlug}/game/map`)
  }

  // Fallback: redirect to root (user can select resort)
  return NextResponse.redirect(`${origin}/`)
}

