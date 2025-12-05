-- Add is_admin field to user_metadata table
ALTER TABLE user_metadata
ADD COLUMN IF NOT EXISTS is_admin boolean DEFAULT false;

-- Create index for admin queries
CREATE INDEX IF NOT EXISTS idx_user_metadata_is_admin ON user_metadata(is_admin);

-- Update RLS policy to allow admins to manage resorts
DROP POLICY IF EXISTS "Resorts can be managed by authenticated users" ON resorts;
CREATE POLICY "Resorts can be managed by admins or resort owners"
  ON resorts FOR ALL
  USING (
    auth.role() = 'authenticated' AND (
      EXISTS (
        SELECT 1 FROM user_metadata
        WHERE id = auth.uid() AND is_admin = true
      )
      OR EXISTS (
        SELECT 1 FROM user_metadata
        WHERE id = auth.uid() AND resort_id = resorts.id
      )
    )
  );

-- Update signs policy to allow admins to manage
DROP POLICY IF EXISTS "Signs can be managed by authenticated users" ON signs;
CREATE POLICY "Signs can be managed by admins or resort admins"
  ON signs FOR ALL
  USING (
    auth.role() = 'authenticated' AND (
      EXISTS (
        SELECT 1 FROM user_metadata
        WHERE id = auth.uid() AND is_admin = true
      )
      OR EXISTS (
        SELECT 1 FROM user_metadata
        WHERE id = auth.uid() AND resort_id = signs.resort_id
      )
    )
  );

-- Update prizes policy to allow admins to manage
DROP POLICY IF EXISTS "Prizes can be managed by authenticated users" ON prizes;
CREATE POLICY "Prizes can be managed by admins or resort admins"
  ON prizes FOR ALL
  USING (
    auth.role() = 'authenticated' AND (
      EXISTS (
        SELECT 1 FROM user_metadata
        WHERE id = auth.uid() AND is_admin = true
      )
      OR EXISTS (
        SELECT 1 FROM user_metadata
        WHERE id = auth.uid() AND resort_id = prizes.resort_id
      )
    )
  );

-- Allow super admins to view all user metadata (for admin dashboard)
CREATE POLICY "Admins can view all user metadata"
  ON user_metadata FOR SELECT
  USING (
    auth.uid() = id OR EXISTS (
      SELECT 1 FROM user_metadata
      WHERE id = auth.uid() AND is_admin = true
    )
  );

