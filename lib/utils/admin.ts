import { createClient } from '@/lib/supabase/server'

/**
 * Check if the current user is a super admin (can manage all resorts)
 */
export async function isAdmin(): Promise<boolean> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return false

  const { data: metadata } = await supabase
    .from('user_metadata')
    .select('is_admin')
    .eq('id', user.id)
    .single()

  return metadata?.is_admin === true
}

/**
 * Check if the current user is an admin for a specific resort
 * Supports:
 * - Super admins (is_admin = true) - can manage all resorts
 * - Users in resort_admins table - can manage specific resorts
 * - Legacy: users with resort_id in user_metadata - backward compatibility
 */
export async function isResortAdmin(resortId: string): Promise<boolean> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return false

  // Check if user is super admin
  const { data: metadata } = await supabase
    .from('user_metadata')
    .select('is_admin, resort_id')
    .eq('id', user.id)
    .single()

  if (metadata?.is_admin === true) return true

  // Check if user is admin for this resort via resort_admins table (new way)
  const { data: resortAdmin } = await supabase
    .from('resort_admins')
    .select('id')
    .eq('user_id', user.id)
    .eq('resort_id', resortId)
    .maybeSingle()

  if (resortAdmin) return true

  // Legacy: Check if user's resort_id matches (backward compatibility)
  return metadata?.resort_id === resortId
}

/**
 * Get all resorts the current user is an admin of
 * Returns array of resort IDs
 */
export async function getAdminResorts(): Promise<string[]> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return []

  // Check if user is super admin - return empty array (they can manage all)
  const { data: metadata } = await supabase
    .from('user_metadata')
    .select('is_admin, resort_id')
    .eq('id', user.id)
    .single()

  if (metadata?.is_admin === true) {
    // Super admins can manage all resorts, return all resort IDs
    const { data: allResorts } = await supabase
      .from('resorts')
      .select('id')
    
    return allResorts?.map(r => r.id) || []
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

  // Remove duplicates
  return [...new Set(resortIds)]
}

