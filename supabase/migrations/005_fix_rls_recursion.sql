-- Fix infinite recursion in user_metadata RLS policy
-- The policy "Admins can view all user metadata" checks user_metadata itself, causing recursion

-- Drop the problematic recursive policy
DROP POLICY IF EXISTS "Admins can view all user metadata" ON user_metadata;

-- For now, users can only see their own metadata
-- Admin checks for viewing other users' data will be handled in the application layer
-- The existing policies already allow:
-- - Users can view their own metadata
-- - Users can update their own metadata  
-- - Users can insert their own metadata

-- Alternative: If you need admins to view all metadata, use a SECURITY DEFINER function
-- that bypasses RLS for admin checks, but that's more complex
