-- Ski Sessions table - tracks a user's skiing session for a day
CREATE TABLE IF NOT EXISTS ski_sessions (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  resort_id uuid REFERENCES resorts(id) ON DELETE CASCADE NOT NULL,
  -- Session date (one session per user per resort per day)
  session_date date NOT NULL DEFAULT CURRENT_DATE,
  -- Timestamps
  started_at timestamptz DEFAULT now(),
  ended_at timestamptz,
  -- Aggregated stats
  total_runs integer DEFAULT 0,
  total_vertical_meters numeric(10, 2) DEFAULT 0,
  total_distance_meters numeric(10, 2) DEFAULT 0,
  top_speed_kmh numeric(6, 2) DEFAULT 0,
  avg_speed_kmh numeric(6, 2) DEFAULT 0,
  -- Active session flag
  is_active boolean DEFAULT true,
  -- Unique constraint: one active session per user per resort per day
  UNIQUE(user_id, resort_id, session_date)
);

-- Run Completions table - tracks individual runs within a session
CREATE TABLE IF NOT EXISTS run_completions (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id uuid REFERENCES ski_sessions(id) ON DELETE CASCADE NOT NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  ski_feature_id uuid REFERENCES ski_features(id) ON DELETE CASCADE NOT NULL,
  -- Completion details
  started_at timestamptz NOT NULL,
  completed_at timestamptz NOT NULL DEFAULT now(),
  -- Run stats
  duration_seconds integer,
  top_speed_kmh numeric(6, 2),
  avg_speed_kmh numeric(6, 2),
  -- GPS track (optional - stores the user's path as LineString GeoJSON)
  gps_track jsonb,
  -- How was the run detected?
  detection_method text CHECK (detection_method IN ('gps_proximity', 'manual', 'qr_scan')) DEFAULT 'gps_proximity'
);

-- Location History table - stores GPS breadcrumbs for route visualization
CREATE TABLE IF NOT EXISTS location_history (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id uuid REFERENCES ski_sessions(id) ON DELETE CASCADE NOT NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  -- Location data
  latitude numeric(10, 8) NOT NULL,
  longitude numeric(11, 8) NOT NULL,
  altitude_meters numeric(8, 2),
  speed_kmh numeric(6, 2),
  accuracy_meters numeric(6, 2),
  -- Timestamp
  recorded_at timestamptz DEFAULT now()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_ski_sessions_user_id ON ski_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_ski_sessions_resort_id ON ski_sessions(resort_id);
CREATE INDEX IF NOT EXISTS idx_ski_sessions_session_date ON ski_sessions(session_date);
CREATE INDEX IF NOT EXISTS idx_ski_sessions_is_active ON ski_sessions(is_active);

CREATE INDEX IF NOT EXISTS idx_run_completions_session_id ON run_completions(session_id);
CREATE INDEX IF NOT EXISTS idx_run_completions_user_id ON run_completions(user_id);
CREATE INDEX IF NOT EXISTS idx_run_completions_ski_feature_id ON run_completions(ski_feature_id);
CREATE INDEX IF NOT EXISTS idx_run_completions_completed_at ON run_completions(completed_at);

CREATE INDEX IF NOT EXISTS idx_location_history_session_id ON location_history(session_id);
CREATE INDEX IF NOT EXISTS idx_location_history_user_id ON location_history(user_id);
CREATE INDEX IF NOT EXISTS idx_location_history_recorded_at ON location_history(recorded_at);

-- Enable RLS
ALTER TABLE ski_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE run_completions ENABLE ROW LEVEL SECURITY;
ALTER TABLE location_history ENABLE ROW LEVEL SECURITY;

-- RLS Policies for ski_sessions
CREATE POLICY "Users can view their own sessions"
  ON ski_sessions FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own sessions"
  ON ski_sessions FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own sessions"
  ON ski_sessions FOR UPDATE
  USING (auth.uid() = user_id);

-- RLS Policies for run_completions
CREATE POLICY "Users can view their own run completions"
  ON run_completions FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own run completions"
  ON run_completions FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own run completions"
  ON run_completions FOR UPDATE
  USING (auth.uid() = user_id);

-- RLS Policies for location_history
CREATE POLICY "Users can view their own location history"
  ON location_history FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own location history"
  ON location_history FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Admins can view session data for analytics
CREATE POLICY "Super admins can view all sessions"
  ON ski_sessions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_metadata
      WHERE id = auth.uid() AND is_admin = true
    )
  );

CREATE POLICY "Super admins can view all run completions"
  ON run_completions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_metadata
      WHERE id = auth.uid() AND is_admin = true
    )
  );

-- Function to get or create today's session
CREATE OR REPLACE FUNCTION get_or_create_session(
  p_user_id uuid,
  p_resort_id uuid
)
RETURNS uuid AS $$
DECLARE
  v_session_id uuid;
BEGIN
  -- Try to find existing session for today
  SELECT id INTO v_session_id
  FROM ski_sessions
  WHERE user_id = p_user_id
    AND resort_id = p_resort_id
    AND session_date = CURRENT_DATE;

  -- If no session exists, create one
  IF v_session_id IS NULL THEN
    INSERT INTO ski_sessions (user_id, resort_id, session_date)
    VALUES (p_user_id, p_resort_id, CURRENT_DATE)
    RETURNING id INTO v_session_id;
  END IF;

  RETURN v_session_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to update session stats after a run completion
CREATE OR REPLACE FUNCTION update_session_stats()
RETURNS TRIGGER AS $$
BEGIN
  -- Update session aggregates
  UPDATE ski_sessions
  SET 
    total_runs = (
      SELECT COUNT(*) FROM run_completions WHERE session_id = NEW.session_id
    ),
    top_speed_kmh = GREATEST(
      COALESCE(top_speed_kmh, 0),
      COALESCE(NEW.top_speed_kmh, 0)
    ),
    ended_at = now()
  WHERE id = NEW.session_id;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to update session stats
CREATE TRIGGER update_session_stats_trigger
  AFTER INSERT ON run_completions
  FOR EACH ROW
  EXECUTE FUNCTION update_session_stats();

-- Function to calculate vertical and distance from location history
CREATE OR REPLACE FUNCTION calculate_session_metrics(p_session_id uuid)
RETURNS TABLE(total_vertical numeric, total_distance numeric) AS $$
BEGIN
  RETURN QUERY
  WITH ordered_locations AS (
    SELECT 
      latitude,
      longitude,
      altitude_meters,
      recorded_at,
      LAG(latitude) OVER (ORDER BY recorded_at) as prev_lat,
      LAG(longitude) OVER (ORDER BY recorded_at) as prev_lng,
      LAG(altitude_meters) OVER (ORDER BY recorded_at) as prev_alt
    FROM location_history
    WHERE session_id = p_session_id
    ORDER BY recorded_at
  )
  SELECT 
    -- Total vertical (sum of altitude drops, only counting descents)
    COALESCE(SUM(
      CASE 
        WHEN prev_alt IS NOT NULL AND prev_alt > altitude_meters 
        THEN prev_alt - altitude_meters 
        ELSE 0 
      END
    ), 0) as total_vertical,
    -- Total distance (haversine formula approximation)
    COALESCE(SUM(
      CASE 
        WHEN prev_lat IS NOT NULL THEN
          111320 * SQRT(
            POWER(latitude - prev_lat, 2) + 
            POWER((longitude - prev_lng) * COS(RADIANS(latitude)), 2)
          )
        ELSE 0 
      END
    ), 0) as total_distance
  FROM ordered_locations;
END;
$$ LANGUAGE plpgsql;

