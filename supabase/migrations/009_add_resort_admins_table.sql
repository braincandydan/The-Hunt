-- Create junction table for many-to-many relationship between users and resorts
-- This allows a user to be an admin of multiple resorts
CREATE TABLE IF NOT EXISTS resort_admins (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  resort_id uuid REFERENCES resorts(id) ON DELETE CASCADE NOT NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE(user_id, resort_id) -- Prevent duplicate admin assignments
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_resort_admins_user_id ON resort_admins(user_id);
CREATE INDEX IF NOT EXISTS idx_resort_admins_resort_id ON resort_admins(resort_id);

-- Enable RLS
ALTER TABLE resort_admins ENABLE ROW LEVEL SECURITY;

-- Users can view their own admin assignments
CREATE POLICY "Users can view their own resort admin assignments"
  ON resort_admins FOR SELECT
  USING (auth.uid() = user_id);

-- Super admins can view all admin assignments
CREATE POLICY "Super admins can view all resort admin assignments"
  ON resort_admins FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_metadata
      WHERE id = auth.uid() AND is_admin = true
    )
  );

-- Super admins can manage admin assignments
CREATE POLICY "Super admins can manage resort admin assignments"
  ON resort_admins FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM user_metadata
      WHERE id = auth.uid() AND is_admin = true
    )
  );

-- Update RLS policies to check resort_admins table
-- Resorts: Allow super admins OR users in resort_admins table
DROP POLICY IF EXISTS "Resorts can be managed by admins or resort owners" ON resorts;
CREATE POLICY "Resorts can be managed by super admins or resort admins"
  ON resorts FOR ALL
  USING (
    auth.role() = 'authenticated' AND (
      EXISTS (
        SELECT 1 FROM user_metadata
        WHERE id = auth.uid() AND is_admin = true
      )
      OR EXISTS (
        SELECT 1 FROM resort_admins
        WHERE user_id = auth.uid() AND resort_id = resorts.id
      )
      -- Legacy: still support old resort_id in user_metadata for backward compatibility
      OR EXISTS (
        SELECT 1 FROM user_metadata
        WHERE id = auth.uid() AND resort_id = resorts.id
      )
    )
  );

-- Signs: Allow super admins OR users in resort_admins table
DROP POLICY IF EXISTS "Signs can be managed by admins or resort admins" ON signs;
CREATE POLICY "Signs can be managed by super admins or resort admins"
  ON signs FOR ALL
  USING (
    auth.role() = 'authenticated' AND (
      EXISTS (
        SELECT 1 FROM user_metadata
        WHERE id = auth.uid() AND is_admin = true
      )
      OR EXISTS (
        SELECT 1 FROM resort_admins
        WHERE user_id = auth.uid() AND resort_id = signs.resort_id
      )
      -- Legacy: still support old resort_id in user_metadata
      OR EXISTS (
        SELECT 1 FROM user_metadata
        WHERE id = auth.uid() AND resort_id = signs.resort_id
      )
    )
  );

-- Prizes: Allow super admins OR users in resort_admins table
DROP POLICY IF EXISTS "Prizes can be managed by admins or resort admins" ON prizes;
CREATE POLICY "Prizes can be managed by super admins or resort admins"
  ON prizes FOR ALL
  USING (
    auth.role() = 'authenticated' AND (
      EXISTS (
        SELECT 1 FROM user_metadata
        WHERE id = auth.uid() AND is_admin = true
      )
      OR EXISTS (
        SELECT 1 FROM resort_admins
        WHERE user_id = auth.uid() AND resort_id = prizes.resort_id
      )
      -- Legacy: still support old resort_id in user_metadata
      OR EXISTS (
        SELECT 1 FROM user_metadata
        WHERE id = auth.uid() AND resort_id = prizes.resort_id
      )
    )
  );

-- Ski features: Allow super admins OR users in resort_admins table
DROP POLICY IF EXISTS "Ski features can be managed by admins or resort admins" ON ski_features;
CREATE POLICY "Ski features can be managed by super admins or resort admins"
  ON ski_features FOR ALL
  USING (
    auth.role() = 'authenticated' AND (
      EXISTS (
        SELECT 1 FROM user_metadata
        WHERE id = auth.uid() AND is_admin = true
      )
      OR EXISTS (
        SELECT 1 FROM resort_admins
        WHERE user_id = auth.uid() AND resort_id = ski_features.resort_id
      )
      -- Legacy: still support old resort_id in user_metadata
      OR EXISTS (
        SELECT 1 FROM user_metadata
        WHERE id = auth.uid() AND resort_id = ski_features.resort_id
      )
    )
  );

