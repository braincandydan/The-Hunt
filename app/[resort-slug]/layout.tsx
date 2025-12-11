import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import { Resort } from '@/lib/utils/types'

// Sanitize color value - only allow valid CSS color formats
function sanitizeColor(color: unknown): string | null {
  if (typeof color !== 'string') return null
  
  // Allow hex colors (#fff, #ffffff, #ffffffff)
  if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(color)) {
    return color
  }
  
  // Allow rgb/rgba format
  if (/^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(,\s*[\d.]+\s*)?\)$/.test(color)) {
    return color
  }
  
  // Allow hsl/hsla format
  if (/^hsla?\(\s*\d{1,3}\s*,\s*\d{1,3}%\s*,\s*\d{1,3}%\s*(,\s*[\d.]+\s*)?\)$/.test(color)) {
    return color
  }
  
  return null
}

// Sanitize font family - only allow safe characters
function sanitizeFontFamily(font: unknown): string | null {
  if (typeof font !== 'string') return null
  
  // Only allow alphanumeric, spaces, quotes, commas, and hyphens
  if (/^[a-zA-Z0-9\s'",-]+$/.test(font) && font.length < 200) {
    return font
  }
  
  return null
}

export default async function ResortLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ 'resort-slug': string }>
}) {
  const resolvedParams = await params
  const supabase = await createClient()
  
  const { data: resort, error } = await supabase
    .from('resorts')
    .select('*')
    .eq('slug', resolvedParams['resort-slug'])
    .maybeSingle()

  if (error) {
    if (process.env.NODE_ENV === 'development') {
      console.error('[ResortLayout] Query error:', JSON.stringify(error, null, 2))
    }
    notFound()
  }

  if (!resort) {
    notFound()
  }

  // Safely extract and sanitize theme values
  const themeConfig = (resort as Resort).theme_config || {}
  const primaryColor = sanitizeColor(themeConfig.primaryColor)
  const secondaryColor = sanitizeColor(themeConfig.secondaryColor)
  const fontFamily = sanitizeFontFamily(themeConfig.fontFamily)

  // Build CSS custom properties safely using inline styles (no script injection)
  const cssVars: Record<string, string> = {}
  if (primaryColor) cssVars['--color-primary'] = primaryColor
  if (secondaryColor) cssVars['--color-secondary'] = secondaryColor
  if (fontFamily) cssVars['--font-family'] = fontFamily
  
  return (
    <div style={cssVars as React.CSSProperties}>
      {children}
    </div>
  )
}
