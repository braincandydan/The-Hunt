-- Descent Sessions table - groups runs and off-trail segments into a single descent journey
CREATE TABLE IF NOT EXISTS descent_sessions (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id uuid REFERENCES ski_sessions(id) ON DELETE CASCADE NOT NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  -- Descent timing
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  -- Descent stats
  total_segments integer DEFAULT 0,
  total_distance_meters numeric(10, 2) DEFAULT 0,
  total_vertical_meters numeric(10, 2) DEFAULT 0,
  top_speed_kmh numeric(6, 2) DEFAULT 0,
  avg_speed_kmh numeric(6, 2) DEFAULT 0,
  -- Active flag
  is_active boolean DEFAULT true
);

-- Extend run_completions table for descent tracking
ALTER TABLE run_completions
  ADD COLUMN IF NOT EXISTS descent_session_id uuid REFERENCES descent_sessions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS segment_type text CHECK (segment_type IN ('on_trail', 'off_trail')) DEFAULT 'on_trail',
  ADD COLUMN IF NOT EXISTS sequence_order integer,
  ADD COLUMN IF NOT EXISTS associated_run_id uuid REFERENCES run_completions(id) ON DELETE SET NULL;

-- Make ski_feature_id nullable for off-trail segments
ALTER TABLE run_completions
  ALTER COLUMN ski_feature_id DROP NOT NULL;

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_descent_sessions_session_id ON descent_sessions(session_id);
CREATE INDEX IF NOT EXISTS idx_descent_sessions_user_id ON descent_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_descent_sessions_started_at ON descent_sessions(started_at);
CREATE INDEX IF NOT EXISTS idx_descent_sessions_is_active ON descent_sessions(is_active);

CREATE INDEX IF NOT EXISTS idx_run_completions_descent_session_id ON run_completions(descent_session_id);
CREATE INDEX IF NOT EXISTS idx_run_completions_segment_type ON run_completions(segment_type);
CREATE INDEX IF NOT EXISTS idx_run_completions_sequence_order ON run_completions(sequence_order);
CREATE INDEX IF NOT EXISTS idx_run_completions_associated_run_id ON run_completions(associated_run_id);

-- Enable RLS
ALTER TABLE descent_sessions ENABLE ROW LEVEL SECURITY;

-- RLS Policies for descent_sessions
CREATE POLICY "Users can view their own descent sessions"
  ON descent_sessions FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own descent sessions"
  ON descent_sessions FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own descent sessions"
  ON descent_sessions FOR UPDATE
  USING (auth.uid() = user_id);

-- Admins can view all descent sessions
CREATE POLICY "Super admins can view all descent sessions"
  ON descent_sessions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_metadata
      WHERE id = auth.uid() AND is_admin = true
    )
  );

-- Function to get or create active descent session for a ski session
CREATE OR REPLACE FUNCTION get_or_create_active_descent_session(
  p_session_id uuid,
  p_user_id uuid
)
RETURNS uuid AS $$
DECLARE
  v_descent_id uuid;
BEGIN
  -- Try to find active descent session
  SELECT id INTO v_descent_id
  FROM descent_sessions
  WHERE session_id = p_session_id
    AND user_id = p_user_id
    AND is_active = true
  ORDER BY started_at DESC
  LIMIT 1;

  -- If no active descent session exists, create one
  IF v_descent_id IS NULL THEN
    INSERT INTO descent_sessions (session_id, user_id, started_at, is_active)
    VALUES (p_session_id, p_user_id, now(), true)
    RETURNING id INTO v_descent_id;
  END IF;

  RETURN v_descent_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to end a descent session
CREATE OR REPLACE FUNCTION end_descent_session(
  p_descent_id uuid,
  p_user_id uuid
)
RETURNS void AS $$
DECLARE
  v_ended_at timestamptz;
  v_started_at timestamptz;
BEGIN
  -- Get the actual end time from the last segment's completed_at
  SELECT MAX(completed_at) INTO v_ended_at
  FROM run_completions
  WHERE descent_session_id = p_descent_id;
  
  -- Get the actual start time from the first segment's started_at
  SELECT MIN(started_at) INTO v_started_at
  FROM run_completions
  WHERE descent_session_id = p_descent_id;
  
  -- If no segments found, use now() as fallback
  IF v_ended_at IS NULL THEN
    v_ended_at := now();
  END IF;
  IF v_started_at IS NULL THEN
    v_started_at := now();
  END IF;
  
  UPDATE descent_sessions
  SET 
    started_at = v_started_at, -- Update start time to match first segment
    ended_at = v_ended_at, -- Use actual end time from last segment
    is_active = false,
    total_segments = (
      SELECT COUNT(*) FROM run_completions WHERE descent_session_id = p_descent_id
    ),
    top_speed_kmh = (
      SELECT COALESCE(MAX(top_speed_kmh), 0) 
      FROM run_completions 
      WHERE descent_session_id = p_descent_id
    ),
    avg_speed_kmh = (
      SELECT COALESCE(AVG(avg_speed_kmh), 0)
      FROM run_completions
      WHERE descent_session_id = p_descent_id
      AND avg_speed_kmh IS NOT NULL
    )
  WHERE id = p_descent_id
    AND user_id = p_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

