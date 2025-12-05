import { createClient } from '@/lib/supabase/server'

/**
 * Check if the current user is an admin
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

  // Check if user is admin for this specific resort
  return metadata?.resort_id === resortId
}

