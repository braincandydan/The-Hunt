import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

// Validate resort slug format - only allow safe characters
function isValidSlugFormat(slug: string): boolean {
  // Only allow lowercase letters, numbers, and hyphens
  // Max 100 chars to prevent abuse
  return /^[a-z0-9-]+$/.test(slug) && slug.length > 0 && slug.length <= 100
}

// Extract and validate resort slug from various sources
function extractResortSlug(referer: string, state: string | null): string | null {
  let resortSlug: string | null = null
  
  // First, try state parameter (more reliable than referer)
  if (state) {
    try {
      // Try parsing as JSON
      const stateData = JSON.parse(decodeURIComponent(state))
      if (typeof stateData.resortSlug === 'string') {
        const slug = stateData.resortSlug.toLowerCase().trim()
        if (isValidSlugFormat(slug)) {
          resortSlug = slug
        }
      }
    } catch {
      // If not JSON, try using state directly as slug
      const slug = state.toLowerCase().trim()
      if (isValidSlugFormat(slug) && !slug.includes('{')) {
        resortSlug = slug
      }
    }
  }
  
  // Fallback to referer if no valid state
  if (!resortSlug && referer) {
    try {
      const refererUrl = new URL(referer)
      const pathMatch = refererUrl.pathname.match(/^\/([^/]+)/)
      if (pathMatch) {
        const slug = pathMatch[1].toLowerCase().trim()
        // Exclude known non-resort paths
        const reservedPaths = ['login', 'auth', 'admin', 'api', '_next', 'favicon.ico']
        if (isValidSlugFormat(slug) && !reservedPaths.includes(slug)) {
          resortSlug = slug
        }
      }
    } catch {
      // Invalid referer URL, ignore
    }
  }
  
  return resortSlug
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url)
  const code = requestUrl.searchParams.get('code')
  const origin = requestUrl.origin

  if (code) {
    const supabase = await createClient()
    await supabase.auth.exchangeCodeForSession(code)
  }

  // Extract resort slug with validation
  const referer = request.headers.get('referer') || ''
  const state = requestUrl.searchParams.get('state')
  const resortSlug = extractResortSlug(referer, state)

  // Redirect to resort game map if we have a valid slug, otherwise root
  if (resortSlug) {
    // Build safe redirect URL - slug is already validated
    return NextResponse.redirect(new URL(`/${resortSlug}/game/map`, origin))
  }

  // Fallback: redirect to root (user can select resort)
  return NextResponse.redirect(new URL('/', origin))
}

