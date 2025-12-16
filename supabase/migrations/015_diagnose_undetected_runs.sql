-- Diagnostic function to identify GPS location points that were near runs but didn't result in run completions
-- This helps understand why some GPS tracking data wasn't associated with runs

-- First, we need a function to calculate distance between two points (Haversine formula)
CREATE OR REPLACE FUNCTION haversine_distance(
  lat1 numeric,
  lon1 numeric,
  lat2 numeric,
  lon2 numeric
)
RETURNS numeric AS $$
DECLARE
  R numeric := 6371000; -- Earth's radius in meters
  phi1 numeric;
  phi2 numeric;
  delta_phi numeric;
  delta_lambda numeric;
  a numeric;
  c numeric;
BEGIN
  phi1 := radians(lat1);
  phi2 := radians(lat2);
  delta_phi := radians(lat2 - lat1);
  delta_lambda := radians(lon2 - lon1);
  
  a := sin(delta_phi/2) * sin(delta_phi/2) +
       cos(phi1) * cos(phi2) *
       sin(delta_lambda/2) * sin(delta_lambda/2);
  c := 2 * atan2(sqrt(a), sqrt(1-a));
  
  RETURN R * c;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Function to find closest point on a LineString (simplified - finds closest coordinate point)
-- This is an approximation - finds the minimum distance to any point on the line
-- For exact distance to line segment, would need PostGIS or more complex math
CREATE OR REPLACE FUNCTION find_closest_point_on_line(
  user_lat numeric,
  user_lon numeric,
  line_coords jsonb -- Array of [lng, lat] coordinates
)
RETURNS numeric AS $$
DECLARE
  min_distance numeric := 999999999;
  coord jsonb;
  point_lat numeric;
  point_lon numeric;
  distance numeric;
  i integer;
  coord_count integer;
BEGIN
  -- Handle LineString (array of [lng, lat] pairs)
  IF jsonb_typeof(line_coords) = 'array' THEN
    coord_count := jsonb_array_length(line_coords);
    
    FOR i IN 0..coord_count-1 LOOP
      coord := line_coords->i;
      
      -- GeoJSON format is [lng, lat]
      IF jsonb_typeof(coord) = 'array' AND jsonb_array_length(coord) >= 2 THEN
        point_lon := (coord->>0)::numeric;
        point_lat := (coord->>1)::numeric;
        
        distance := haversine_distance(user_lat, user_lon, point_lat, point_lon);
        
        IF distance < min_distance THEN
          min_distance := distance;
        END IF;
      END IF;
    END LOOP;
  END IF;
  
  RETURN min_distance;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Main diagnostic function
CREATE OR REPLACE FUNCTION diagnose_undetected_runs(
  p_session_id uuid DEFAULT NULL,
  p_proximity_threshold numeric DEFAULT 30 -- meters
)
RETURNS TABLE(
  location_id uuid,
  session_id uuid,
  latitude numeric,
  longitude numeric,
  recorded_at timestamptz,
  speed_kmh numeric,
  closest_run_id uuid,
  closest_run_name text,
  distance_to_run numeric,
  within_threshold boolean,
  has_completion boolean,
  completion_id uuid,
  reason text
) AS $$
BEGIN
  RETURN QUERY
  WITH location_points AS (
    SELECT 
      lh.id,
      lh.session_id,
      lh.latitude,
      lh.longitude,
      lh.recorded_at,
      lh.speed_kmh
    FROM location_history lh
    WHERE (p_session_id IS NULL OR lh.session_id = p_session_id)
      AND lh.speed_kmh > 5 -- Only check points where user was moving (filter out stationary points)
  ),
  run_geometries AS (
    SELECT 
      sf.id as run_id,
      sf.name as run_name,
      sf.geometry,
      CASE 
        WHEN sf.geometry->>'type' = 'LineString' THEN
          sf.geometry->'coordinates'
        WHEN sf.geometry->>'type' = 'MultiLineString' THEN
          -- For MultiLineString, use first line segment for approximation
          (sf.geometry->'coordinates'->0)
        ELSE NULL
      END as line_coords,
      -- Get first coordinate for rough distance filtering
      CASE
        WHEN sf.geometry->>'type' = 'LineString' THEN
          (sf.geometry->'coordinates'->0)
        WHEN sf.geometry->>'type' = 'MultiLineString' THEN
          (sf.geometry->'coordinates'->0->0)
        ELSE NULL
      END as first_coord
    FROM ski_features sf
    WHERE sf.type = 'trail'
      AND sf.active = true
      AND sf.geometry IS NOT NULL
  ),
  closest_runs AS (
    SELECT 
      lp.id as location_id,
      lp.session_id,
      lp.latitude,
      lp.longitude,
      lp.recorded_at,
      lp.speed_kmh,
      rg.run_id,
      rg.run_name,
      CASE
        WHEN rg.line_coords IS NOT NULL THEN
          find_closest_point_on_line(lp.latitude, lp.longitude, rg.line_coords)
        ELSE
          999999
      END as distance
    FROM location_points lp
    CROSS JOIN run_geometries rg
    WHERE rg.line_coords IS NOT NULL
      AND rg.first_coord IS NOT NULL
      -- Pre-filter: only check runs that are roughly in the same area (within 500m of first point)
      -- This avoids expensive distance calculations for very distant runs
      AND haversine_distance(lp.latitude, lp.longitude, 
        (rg.first_coord->>1)::numeric, 
        (rg.first_coord->>0)::numeric) < 500
  ),
  min_distances AS (
    SELECT DISTINCT ON (closest_runs.location_id)
      closest_runs.location_id,
      closest_runs.session_id,
      closest_runs.latitude,
      closest_runs.longitude,
      closest_runs.recorded_at,
      closest_runs.speed_kmh,
      closest_runs.run_id as closest_run_id,
      closest_runs.run_name as closest_run_name,
      closest_runs.distance as distance_to_run
    FROM closest_runs
    ORDER BY closest_runs.location_id, closest_runs.distance ASC
  ),
  completion_check AS (
    SELECT 
      md.*,
      CASE 
        WHEN md.distance_to_run <= p_proximity_threshold THEN true
        ELSE false
      END as within_threshold,
      rc.id as completion_id,
      CASE 
        WHEN rc.id IS NOT NULL THEN true
        ELSE false
      END as has_completion
    FROM min_distances md
    LEFT JOIN run_completions rc ON 
      rc.session_id = md.session_id
      AND rc.ski_feature_id = md.closest_run_id
      AND ABS(EXTRACT(EPOCH FROM (rc.started_at - md.recorded_at))) < 300 -- Within 5 minutes
  )
  SELECT 
    cc.location_id,
    cc.session_id,
    cc.latitude,
    cc.longitude,
    cc.recorded_at,
    cc.speed_kmh,
    cc.closest_run_id,
    cc.closest_run_name,
    cc.distance_to_run,
    cc.within_threshold,
    cc.has_completion,
    cc.completion_id,
    CASE
      WHEN cc.within_threshold AND NOT cc.has_completion THEN
        'Within threshold but no completion - run detection may have failed'
      WHEN NOT cc.within_threshold THEN
        format('Too far from run (%.1fm > %.1fm threshold)', cc.distance_to_run, p_proximity_threshold)
      WHEN cc.has_completion THEN
        'Already has completion'
      ELSE
        'Unknown'
    END as reason
  FROM completion_check cc
  WHERE cc.within_threshold AND NOT cc.has_completion -- Only show points that should have been detected
  ORDER BY cc.recorded_at;
END;
$$ LANGUAGE plpgsql;

-- Example usage:
-- SELECT * FROM diagnose_undetected_runs(); -- All sessions
-- SELECT * FROM diagnose_undetected_runs('your-session-id'); -- Specific session
-- SELECT * FROM diagnose_undetected_runs('your-session-id', 50); -- With custom threshold (50m)

-- Simplified summary query - samples location points (every 10th point) for performance
CREATE OR REPLACE FUNCTION diagnose_undetected_runs_summary(
  p_session_id uuid DEFAULT NULL,
  p_proximity_threshold numeric DEFAULT 30,
  p_sample_rate integer DEFAULT 10 -- Check every Nth point (10 = every 10th point)
)
RETURNS TABLE(
  session_id uuid,
  total_location_points bigint,
  sampled_points bigint,
  points_near_runs bigint,
  points_with_completions bigint,
  missed_detections bigint,
  closest_run_id uuid,
  closest_run_name text,
  avg_distance numeric,
  max_distance numeric,
  min_distance numeric
) AS $$
BEGIN
  RETURN QUERY
  WITH sampled_locations AS (
    SELECT 
      lh.id,
      lh.session_id,
      lh.latitude,
      lh.longitude,
      lh.recorded_at,
      lh.speed_kmh,
      ROW_NUMBER() OVER (PARTITION BY lh.session_id ORDER BY lh.recorded_at) as row_num
    FROM location_history lh
    WHERE (p_session_id IS NULL OR lh.session_id = p_session_id)
      AND lh.speed_kmh > 5 -- Only moving points
  ),
  location_points AS (
    SELECT * FROM sampled_locations
    WHERE row_num % p_sample_rate = 0 -- Sample every Nth point
  ),
  total_counts AS (
    SELECT 
      session_id,
      COUNT(*) as total_points
    FROM location_history
    WHERE (p_session_id IS NULL OR session_id = p_session_id)
      AND speed_kmh > 5
    GROUP BY session_id
  ),
  diagnostics AS (
    SELECT * FROM diagnose_undetected_runs(p_session_id, p_proximity_threshold)
    WHERE location_id IN (SELECT id FROM location_points)
  ),
  session_stats AS (
    SELECT 
      tc.session_id,
      tc.total_points,
      COUNT(d.*) as sampled_points,
      COUNT(*) FILTER (WHERE d.within_threshold) as points_near_runs,
      COUNT(*) FILTER (WHERE d.has_completion) as points_with_completions,
      COUNT(*) FILTER (WHERE d.within_threshold AND NOT d.has_completion) as missed_detections
    FROM total_counts tc
    LEFT JOIN diagnostics d ON d.session_id = tc.session_id
    GROUP BY tc.session_id, tc.total_points
  ),
  run_stats AS (
    SELECT 
      session_id,
      closest_run_id,
      closest_run_name,
      COUNT(*) as missed_count,
      AVG(distance_to_run) as avg_distance,
      MAX(distance_to_run) as max_distance,
      MIN(distance_to_run) as min_distance
    FROM diagnostics
    WHERE within_threshold AND NOT has_completion
    GROUP BY session_id, closest_run_id, closest_run_name
  )
  SELECT 
    ss.session_id,
    ss.total_points,
    ss.sampled_points,
    ss.points_near_runs,
    ss.points_with_completions,
    ss.missed_detections,
    rs.closest_run_id,
    rs.closest_run_name,
    rs.avg_distance,
    rs.max_distance,
    rs.min_distance
  FROM session_stats ss
  LEFT JOIN run_stats rs ON rs.session_id = ss.session_id
  ORDER BY ss.missed_detections DESC NULLS LAST;
END;
$$ LANGUAGE plpgsql;

