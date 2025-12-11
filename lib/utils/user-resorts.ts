import { createClient } from '@/lib/supabase/server'

/**
 * Get all resorts a user has joined/played at
 */
export async function getUserResorts(): Promise<Array<{
  resort_id: string
  resort: {
    id: string
    name: string
    slug: string
  }
  joined_at: string
  last_activity_at: string
  completed: boolean
}>> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return []

  const { data: userResorts } = await supabase
    .from('user_resorts')
    .select(`
      resort_id,
      joined_at,
      last_activity_at,
      completed,
      resorts (
        id,
        name,
        slug
      )
    `)
    .eq('user_id', user.id)
    .order('last_activity_at', { ascending: false })

  if (!userResorts) return []

  return userResorts.map(ur => {
    // Handle the case where resorts might be an array or single object from Supabase join
    const resort = Array.isArray(ur.resorts) ? ur.resorts[0] : ur.resorts
    return {
      resort_id: ur.resort_id,
      resort: resort as { id: string; name: string; slug: string },
      joined_at: ur.joined_at,
      last_activity_at: ur.last_activity_at,
      completed: ur.completed || false,
    }
  })
}

/**
 * Join a resort (add user-resort association)
 * This is called when user signs up at a resort or first accesses it
 */
export async function joinResort(resortId: string): Promise<boolean> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return false

  const { error } = await supabase
    .from('user_resorts')
    .insert({
      user_id: user.id,
      resort_id: resortId,
    })
    // Use upsert to avoid errors if already exists
    .select()
    .single()

  // If error and it's not a duplicate, return false
  if (error && !error.message.includes('duplicate')) {
    console.error('Error joining resort:', error)
    return false
  }

  return true
}

/**
 * Check if user has joined a specific resort
 */
export async function hasJoinedResort(resortId: string): Promise<boolean> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return false

  const { data } = await supabase
    .from('user_resorts')
    .select('id')
    .eq('user_id', user.id)
    .eq('resort_id', resortId)
    .maybeSingle()

  return !!data
}

/**
 * Mark a resort as completed for the user
 */
export async function markResortCompleted(resortId: string): Promise<boolean> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return false

  const { error } = await supabase
    .from('user_resorts')
    .update({
      completed: true,
      completed_at: new Date().toISOString(),
    })
    .eq('user_id', user.id)
    .eq('resort_id', resortId)

  return !error
}

