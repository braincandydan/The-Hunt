-- Create junction table for many-to-many relationship between users and resorts
-- This tracks which resorts a user has "joined" or played at
-- Unlike resort_admins, this is for regular users (players), not admins
CREATE TABLE IF NOT EXISTS user_resorts (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  resort_id uuid REFERENCES resorts(id) ON DELETE CASCADE NOT NULL,
  -- Track when user first joined this resort
  joined_at timestamptz DEFAULT now(),
  -- Optional: Track last activity at this resort
  last_activity_at timestamptz DEFAULT now(),
  -- Optional: Track if user has completed the hunt at this resort
  completed boolean DEFAULT false,
  -- Optional: Track completion date
  completed_at timestamptz,
  UNIQUE(user_id, resort_id) -- Prevent duplicate entries
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_user_resorts_user_id ON user_resorts(user_id);
CREATE INDEX IF NOT EXISTS idx_user_resorts_resort_id ON user_resorts(resort_id);
CREATE INDEX IF NOT EXISTS idx_user_resorts_completed ON user_resorts(completed);

-- Enable RLS
ALTER TABLE user_resorts ENABLE ROW LEVEL SECURITY;

-- Users can view their own resort associations
CREATE POLICY "Users can view their own resort associations"
  ON user_resorts FOR SELECT
  USING (auth.uid() = user_id);

-- Users can insert their own resort associations (when they join a resort)
CREATE POLICY "Users can join resorts"
  ON user_resorts FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Users can update their own resort associations (e.g., mark as completed)
CREATE POLICY "Users can update their own resort associations"
  ON user_resorts FOR UPDATE
  USING (auth.uid() = user_id);

-- Super admins can view all user-resort associations (for analytics)
CREATE POLICY "Super admins can view all user-resort associations"
  ON user_resorts FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_metadata
      WHERE id = auth.uid() AND is_admin = true
    )
  );

-- Function to automatically update last_activity_at when user makes a discovery
CREATE OR REPLACE FUNCTION update_user_resort_activity()
RETURNS TRIGGER AS $$
BEGIN
  -- Update last_activity_at for the user-resort association
  -- based on the sign's resort_id
  UPDATE user_resorts
  SET last_activity_at = now()
  WHERE user_id = NEW.user_id
    AND resort_id = (
      SELECT resort_id FROM signs WHERE id = NEW.sign_id
    );
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to update activity when user makes a discovery
CREATE TRIGGER update_user_resort_activity_trigger
  AFTER INSERT ON user_discoveries
  FOR EACH ROW
  EXECUTE FUNCTION update_user_resort_activity();

-- Function to automatically create user_resorts entry when user makes first discovery
CREATE OR REPLACE FUNCTION auto_join_resort_on_discovery()
RETURNS TRIGGER AS $$
DECLARE
  sign_resort_id uuid;
BEGIN
  -- Get the resort_id from the sign
  SELECT resort_id INTO sign_resort_id
  FROM signs
  WHERE id = NEW.sign_id;
  
  -- Insert user-resort association if it doesn't exist
  INSERT INTO user_resorts (user_id, resort_id)
  VALUES (NEW.user_id, sign_resort_id)
  ON CONFLICT (user_id, resort_id) DO NOTHING;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-join resort when user makes first discovery
CREATE TRIGGER auto_join_resort_on_discovery_trigger
  AFTER INSERT ON user_discoveries
  FOR EACH ROW
  EXECUTE FUNCTION auto_join_resort_on_discovery();

