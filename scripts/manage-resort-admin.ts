/**
 * Script to manage resort admin assignments
 * 
 * Usage:
 *   # Add user as admin of a resort
 *   npx tsx scripts/manage-resort-admin.ts add <user-email> <resort-slug>
 * 
 *   # Remove user as admin of a resort
 *   npx tsx scripts/manage-resort-admin.ts remove <user-email> <resort-slug>
 * 
 *   # List all resorts a user is admin of
 *   npx tsx scripts/manage-resort-admin.ts list <user-email>
 * 
 *   # List all admins of a resort
 *   npx tsx scripts/manage-resort-admin.ts list-admins <resort-slug>
 */

import { createClient } from '@supabase/supabase-js'
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
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
})

async function addResortAdmin(userEmail: string, resortSlug: string) {
  console.log(`\n➕ Adding ${userEmail} as admin of ${resortSlug}...`)

  // Get user by email
  const { data: { users }, error: userError } = await supabase.auth.admin.listUsers()
  const user = users?.find(u => u.email === userEmail)

  if (!user) {
    console.error(`❌ User with email "${userEmail}" not found`)
    process.exit(1)
  }

  // Get resort by slug
  const { data: resort, error: resortError } = await supabase
    .from('resorts')
    .select('id, name')
    .eq('slug', resortSlug)
    .single()

  if (resortError || !resort) {
    console.error(`❌ Resort with slug "${resortSlug}" not found`)
    process.exit(1)
  }

  // Check if assignment already exists
  const { data: existing } = await supabase
    .from('resort_admins')
    .select('id')
    .eq('user_id', user.id)
    .eq('resort_id', resort.id)
    .maybeSingle()

  if (existing) {
    console.log(`✅ User is already an admin of ${resort.name}`)
    return
  }

  // Add admin assignment
  const { error: insertError } = await supabase
    .from('resort_admins')
    .insert({
      user_id: user.id,
      resort_id: resort.id,
    })

  if (insertError) {
    console.error('❌ Error adding admin:', insertError.message)
    process.exit(1)
  }

  console.log(`✅ Successfully added ${userEmail} as admin of ${resort.name}`)
}

async function removeResortAdmin(userEmail: string, resortSlug: string) {
  console.log(`\n➖ Removing ${userEmail} as admin of ${resortSlug}...`)

  // Get user by email
  const { data: { users }, error: userError } = await supabase.auth.admin.listUsers()
  const user = users?.find(u => u.email === userEmail)

  if (!user) {
    console.error(`❌ User with email "${userEmail}" not found`)
    process.exit(1)
  }

  // Get resort by slug
  const { data: resort, error: resortError } = await supabase
    .from('resorts')
    .select('id, name')
    .eq('slug', resortSlug)
    .single()

  if (resortError || !resort) {
    console.error(`❌ Resort with slug "${resortSlug}" not found`)
    process.exit(1)
  }

  // Remove admin assignment
  const { error: deleteError } = await supabase
    .from('resort_admins')
    .delete()
    .eq('user_id', user.id)
    .eq('resort_id', resort.id)

  if (deleteError) {
    console.error('❌ Error removing admin:', deleteError.message)
    process.exit(1)
  }

  console.log(`✅ Successfully removed ${userEmail} as admin of ${resort.name}`)
}

async function listUserResorts(userEmail: string) {
  console.log(`\n📋 Listing resorts for ${userEmail}...`)

  // Get user by email
  const { data: { users } } = await supabase.auth.admin.listUsers()
  const user = users?.find(u => u.email === userEmail)

  if (!user) {
    console.error(`❌ User with email "${userEmail}" not found`)
    process.exit(1)
  }

  // Check if super admin
  const { data: metadata } = await supabase
    .from('user_metadata')
    .select('is_admin, resort_id')
    .eq('id', user.id)
    .single()

  if (metadata?.is_admin === true) {
    console.log('🔑 User is a SUPER ADMIN (can manage all resorts)')
    const { data: allResorts } = await supabase
      .from('resorts')
      .select('id, name, slug')
      .order('name')
    
    if (allResorts && allResorts.length > 0) {
      console.log('\nAll resorts:')
      allResorts.forEach(r => {
        console.log(`   - ${r.name} (${r.slug})`)
      })
    }
    return
  }

  // Get resorts from resort_admins table
  const { data: resortAdmins } = await supabase
    .from('resort_admins')
    .select('resort_id')
    .eq('user_id', user.id)

  const resortIds = resortAdmins?.map(ra => ra.resort_id) || []

  // Legacy: Add resort from user_metadata if exists
  if (metadata?.resort_id) {
    resortIds.push(metadata.resort_id)
  }

  if (resortIds.length === 0) {
    console.log('❌ User is not an admin of any resorts')
    return
  }

  // Get resort details
  const { data: resorts } = await supabase
    .from('resorts')
    .select('id, name, slug')
    .in('id', [...new Set(resortIds)])
    .order('name')

  console.log(`\n✅ User is admin of ${resorts?.length || 0} resort(s):`)
  resorts?.forEach(r => {
    console.log(`   - ${r.name} (${r.slug})`)
  })
}

async function listResortAdmins(resortSlug: string) {
  console.log(`\n📋 Listing admins for ${resortSlug}...`)

  // Get resort by slug
  const { data: resort, error: resortError } = await supabase
    .from('resorts')
    .select('id, name')
    .eq('slug', resortSlug)
    .single()

  if (resortError || !resort) {
    console.error(`❌ Resort with slug "${resortSlug}" not found`)
    process.exit(1)
  }

  // Get all users for email lookup
  const { data: { users: allUsers } } = await supabase.auth.admin.listUsers()
  const userMap = new Map(allUsers?.map(u => [u.id, u.email]) || [])

  // Get admins from resort_admins table
  const { data: resortAdmins } = await supabase
    .from('resort_admins')
    .select('user_id')
    .eq('resort_id', resort.id)

  // Get super admins
  const { data: superAdmins } = await supabase
    .from('user_metadata')
    .select('id')
    .eq('is_admin', true)

  // Get legacy admins (from user_metadata.resort_id)
  const { data: legacyAdmins } = await supabase
    .from('user_metadata')
    .select('id')
    .eq('resort_id', resort.id)
    .is('is_admin', false)

  console.log(`\n✅ Admins for ${resort.name}:`)

  // Super admins
  if (superAdmins && superAdmins.length > 0) {
    console.log('\n🔑 Super Admins (can manage all resorts):')
    for (const admin of superAdmins) {
      const email = userMap.get(admin.id)
      if (email) {
        console.log(`   - ${email}`)
      }
    }
  }

  // Resort-specific admins
  if (resortAdmins && resortAdmins.length > 0) {
    console.log('\n👤 Resort-Specific Admins:')
    for (const admin of resortAdmins) {
      const email = userMap.get(admin.user_id)
      if (email) {
        console.log(`   - ${email}`)
      }
    }
  }

  // Legacy admins
  if (legacyAdmins && legacyAdmins.length > 0) {
    console.log('\n📜 Legacy Admins (from user_metadata.resort_id):')
    for (const admin of legacyAdmins) {
      const email = userMap.get(admin.id)
      if (email) {
        console.log(`   - ${email}`)
      }
    }
  }

  const totalAdmins = (superAdmins?.length || 0) + (resortAdmins?.length || 0) + (legacyAdmins?.length || 0)
  if (totalAdmins === 0) {
    console.log('\n❌ No admins found for this resort')
  }
}

async function main() {
  const [command, ...args] = process.argv.slice(2)

  if (!command) {
    console.error('❌ Missing command')
    console.error('\nUsage:')
    console.error('  npx tsx scripts/manage-resort-admin.ts add <user-email> <resort-slug>')
    console.error('  npx tsx scripts/manage-resort-admin.ts remove <user-email> <resort-slug>')
    console.error('  npx tsx scripts/manage-resort-admin.ts list <user-email>')
    console.error('  npx tsx scripts/manage-resort-admin.ts list-admins <resort-slug>')
    process.exit(1)
  }

  switch (command) {
    case 'add':
      if (args.length < 2) {
        console.error('❌ Missing arguments: <user-email> <resort-slug>')
        process.exit(1)
      }
      await addResortAdmin(args[0], args[1])
      break

    case 'remove':
      if (args.length < 2) {
        console.error('❌ Missing arguments: <user-email> <resort-slug>')
        process.exit(1)
      }
      await removeResortAdmin(args[0], args[1])
      break

    case 'list':
      if (args.length < 1) {
        console.error('❌ Missing argument: <user-email>')
        process.exit(1)
      }
      await listUserResorts(args[0])
      break

    case 'list-admins':
      if (args.length < 1) {
        console.error('❌ Missing argument: <resort-slug>')
        process.exit(1)
      }
      await listResortAdmins(args[0])
      break

    default:
      console.error(`❌ Unknown command: ${command}`)
      process.exit(1)
  }
}

main().catch((error) => {
  console.error('\n❌ Unexpected error:', error)
  process.exit(1)
})

