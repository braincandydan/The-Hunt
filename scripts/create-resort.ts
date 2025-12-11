/**
 * Script to create a new resort in the database
 * 
 * Usage:
 *   npx tsx scripts/create-resort.ts
 * 
 * Or with environment variables:
 *   RESORT_NAME="Aspen Mountain" \
 *   RESORT_SLUG="aspen-mountain" \
 *   PRIMARY_COLOR="#FF5733" \
 *   npx tsx scripts/create-resort.ts
 */

import { createClient } from '@supabase/supabase-js'
import * as readline from 'readline'
import * as dotenv from 'dotenv'
import { join } from 'path'

// Load environment variables
dotenv.config({ path: join(process.cwd(), '.env.local') })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing required environment variables:')
  console.error('   NEXT_PUBLIC_SUPABASE_URL')
  console.error('   SUPABASE_SERVICE_ROLE_KEY')
  console.error('\nMake sure these are set in .env.local')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
})

interface ResortInput {
  name: string
  slug: string
  subdomain?: string
  primaryColor?: string
  secondaryColor?: string
  fontFamily?: string
  logoUrl?: string
  mapCenterLat?: number
  mapCenterLng?: number
  mapZoom?: number
}

async function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  })

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close()
      resolve(answer.trim())
    })
  })
}

async function createResort(input: ResortInput) {
  console.log('\n📋 Creating resort with the following details:')
  console.log(`   Name: ${input.name}`)
  console.log(`   Slug: ${input.slug}`)
  if (input.subdomain) console.log(`   Subdomain: ${input.subdomain}`)
  console.log(`   Primary Color: ${input.primaryColor || '#6366f1'}`)
  console.log(`   Secondary Color: ${input.secondaryColor || '#8b5cf6'}`)
  console.log(`   Font: ${input.fontFamily || 'Inter, sans-serif'}`)
  if (input.mapCenterLat && input.mapCenterLng) {
    console.log(`   Map Center: [${input.mapCenterLat}, ${input.mapCenterLng}]`)
    console.log(`   Map Zoom: ${input.mapZoom || 13}`)
  }

  // Check if slug already exists
  const { data: existing } = await supabase
    .from('resorts')
    .select('id, name')
    .eq('slug', input.slug)
    .maybeSingle()

  if (existing) {
    console.error(`\n❌ Error: Resort with slug "${input.slug}" already exists!`)
    console.error(`   Existing resort: ${existing.name}`)
    process.exit(1)
  }

  // Build theme config
  const themeConfig: any = {}
  if (input.primaryColor) themeConfig.primaryColor = input.primaryColor
  if (input.secondaryColor) themeConfig.secondaryColor = input.secondaryColor
  if (input.fontFamily) themeConfig.fontFamily = input.fontFamily
  if (input.logoUrl) themeConfig.logoUrl = input.logoUrl

  // Build map config
  const mapConfig: any = {}
  if (input.mapCenterLat && input.mapCenterLng) {
    mapConfig.center = [input.mapCenterLat, input.mapCenterLng]
  }
  if (input.mapZoom) {
    mapConfig.zoom = input.mapZoom
  }

  // Create resort
  const { data: resort, error } = await supabase
    .from('resorts')
    .insert({
      name: input.name,
      slug: input.slug,
      subdomain: input.subdomain || null,
      theme_config: Object.keys(themeConfig).length > 0 ? themeConfig : null,
      map_config: Object.keys(mapConfig).length > 0 ? mapConfig : null,
    })
    .select()
    .single()

  if (error) {
    console.error('\n❌ Error creating resort:', error.message)
    process.exit(1)
  }

  console.log('\n✅ Resort created successfully!')
  console.log(`\n📊 Resort Details:`)
  console.log(`   ID: ${resort.id}`)
  console.log(`   Name: ${resort.name}`)
  console.log(`   Slug: ${resort.slug}`)
  console.log(`   URL: http://localhost:3000/${resort.slug}`)
  console.log(`   Admin URL: http://localhost:3000/${resort.slug}/admin`)

  console.log(`\n📝 Next Steps:`)
  console.log(`   1. Create an admin user in Supabase Dashboard → Authentication → Users`)
  console.log(`   2. Grant admin access by running:`)
  console.log(`      INSERT INTO user_metadata (id, resort_id, is_admin, display_name)`)
  console.log(`      VALUES ('<user-uuid>', '${resort.id}', true, '${resort.name} Admin');`)
  console.log(`   3. Log in and add signs via the admin panel`)
  console.log(`   4. Configure theme and branding at /${resort.slug}/admin/settings`)

  return resort
}

async function main() {
  console.log('🏔️  Resort Creation Script')
  console.log('========================\n')

  // Check if running with environment variables (non-interactive)
  const hasEnvVars = process.env.RESORT_NAME && process.env.RESORT_SLUG

  let input: ResortInput

  if (hasEnvVars) {
    // Non-interactive mode
    input = {
      name: process.env.RESORT_NAME!,
      slug: process.env.RESORT_SLUG!,
      subdomain: process.env.RESORT_SUBDOMAIN,
      primaryColor: process.env.PRIMARY_COLOR || '#6366f1',
      secondaryColor: process.env.SECONDARY_COLOR || '#8b5cf6',
      fontFamily: process.env.FONT_FAMILY || 'Inter, sans-serif',
      logoUrl: process.env.LOGO_URL,
      mapCenterLat: process.env.MAP_CENTER_LAT ? parseFloat(process.env.MAP_CENTER_LAT) : undefined,
      mapCenterLng: process.env.MAP_CENTER_LNG ? parseFloat(process.env.MAP_CENTER_LNG) : undefined,
      mapZoom: process.env.MAP_ZOOM ? parseInt(process.env.MAP_ZOOM) : undefined,
    }
  } else {
    // Interactive mode
    console.log('Enter resort details (press Enter to use defaults):\n')

    const name = await prompt('Resort Name: ')
    if (!name) {
      console.error('❌ Resort name is required')
      process.exit(1)
    }

    const slug = await prompt('Resort Slug (URL-friendly, e.g., "aspen-mountain"): ')
    if (!slug) {
      console.error('❌ Resort slug is required')
      process.exit(1)
    }

    const subdomain = await prompt('Subdomain (optional, e.g., "aspen"): ') || undefined
    const primaryColor = await prompt('Primary Color (default: #6366f1): ') || '#6366f1'
    const secondaryColor = await prompt('Secondary Color (default: #8b5cf6): ') || '#8b5cf6'
    const fontFamily = await prompt('Font Family (default: Inter, sans-serif): ') || 'Inter, sans-serif'
    const logoUrl = await prompt('Logo URL (optional): ') || undefined

    const mapCenterLatStr = await prompt('Map Center Latitude (optional): ')
    const mapCenterLngStr = await prompt('Map Center Longitude (optional): ')
    const mapZoomStr = await prompt('Map Zoom Level (optional, default: 13): ')

    input = {
      name,
      slug: slug.toLowerCase().replace(/\s+/g, '-'),
      subdomain: subdomain?.toLowerCase() || undefined,
      primaryColor,
      secondaryColor,
      fontFamily,
      logoUrl: logoUrl || undefined,
      mapCenterLat: mapCenterLatStr ? parseFloat(mapCenterLatStr) : undefined,
      mapCenterLng: mapCenterLngStr ? parseFloat(mapCenterLngStr) : undefined,
      mapZoom: mapZoomStr ? parseInt(mapZoomStr) : undefined,
    }
  }

  await createResort(input)
}

main().catch((error) => {
  console.error('\n❌ Unexpected error:', error)
  process.exit(1)
})

