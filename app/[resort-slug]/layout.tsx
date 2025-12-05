import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import { Resort } from '@/lib/utils/types'

export default async function ResortLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ 'resort-slug': string }>
}) {
  const resolvedParams = await params
  const supabase = await createClient()
  
  console.log('[ResortLayout] Starting query for slug:', resolvedParams['resort-slug'])
  
  const { data: resort, error } = await supabase
    .from('resorts')
    .select('*')
    .eq('slug', resolvedParams['resort-slug'])
    .maybeSingle()

  console.log('[ResortLayout] Query completed:', {
    hasResort: !!resort,
    resortName: resort?.name,
    error: error ? JSON.stringify(error) : null
  })

  if (error) {
    console.error('[ResortLayout] Query error:', JSON.stringify(error, null, 2))
    notFound()
  }

  if (!resort) {
    console.error('[ResortLayout] No resort found for slug:', resolvedParams['resort-slug'])
    notFound()
  }

  console.log('[ResortLayout] Resort found, rendering layout')

  // Apply theme client-side
  const themeConfig = (resort as Resort).theme_config || {}
  
  return (
    <>
      <script
        dangerouslySetInnerHTML={{
          __html: `
            (function() {
              const theme = ${JSON.stringify(themeConfig)};
              if (theme && theme.primaryColor) {
                document.documentElement.style.setProperty('--color-primary', theme.primaryColor);
              }
              if (theme && theme.secondaryColor) {
                document.documentElement.style.setProperty('--color-secondary', theme.secondaryColor);
              }
              if (theme && theme.fontFamily) {
                document.documentElement.style.setProperty('--font-family', theme.fontFamily);
              }
            })();
          `,
        }}
      />
      {children}
    </>
  )
}
