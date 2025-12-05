-- Allow service role to manage ski features (for import scripts)
-- The service role key bypasses RLS, but we add this policy for clarity
-- Service role is used by admin scripts and backend operations

-- Note: This migration is optional if you're using SUPABASE_SERVICE_ROLE_KEY
-- Service role key automatically bypasses RLS, but having explicit policies
-- makes the intent clear and helps with debugging

-- If you want to use anon key instead, you'd need to authenticate as an admin user
-- Using service role key is recommended for import scripts

-- This policy allows service role (backend operations) to manage ski features
-- Service role has elevated privileges and should only be used in secure contexts
CREATE POLICY "Service role can manage ski features"
  ON ski_features FOR ALL
  USING (auth.role() = 'service_role');

