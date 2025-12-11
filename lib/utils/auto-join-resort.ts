import { createClient } from '@/lib/supabase/server'

/**
 * Automatically join a resort if user hasn't joined yet
 * This is called when user accesses a resort's game for the first time
 * 
 * @param resortId - The resort ID to join
 * @returns true if joined (or already joined), false on error
 */
export async function autoJoinResortIfNeeded(resortId: string): Promise<boolean> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return false

  // Check if user has already joined this resort
  const { data: existing } = await supabase
    .from('user_resorts')
    .select('id')
    .eq('user_id', user.id)
    .eq('resort_id', resortId)
    .maybeSingle()

  // Already joined, nothing to do
  if (existing) return true

  // Join the resort
  const { error } = await supabase
    .from('user_resorts')
    .insert({
      user_id: user.id,
      resort_id: resortId,
    })

  if (error) {
    // Ignore duplicate key errors (race condition)
    if (error.message.includes('duplicate') || error.code === '23505') {
      return true
    }
    console.error('Error auto-joining resort:', error)
    return false
  }

  return true
}

