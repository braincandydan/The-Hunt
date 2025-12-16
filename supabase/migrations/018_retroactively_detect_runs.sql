-- Retroactively detect runs from GPS location_history and create run_completions
-- This function analyzes GPS tracks and creates run_completions for segments that were missed during real-time tracking
--
-- Usage:
--   SELECT * FROM retroactively_detect_runs('session-id-here');
--   SELECT * FROM retroactively_detect_runs('session-id-here', 30, 10, 3); -- with custom params

-- Function to retroactively detect and create run completions from location_history
CREATE OR REPLACE FUNCTION retroactively_detect_runs(
  p_session_id uuid,
  p_proximity_threshold numeric DEFAULT 30, -- meters
  p_min_duration_seconds integer DEFAULT 10, -- minimum 10 seconds on a run
  p_min_points integer DEFAULT 3 -- minimum 3 GPS points
)
RETURNS TABLE(
  created_count integer,
  run_id uuid,
  run_name text,
  start_time timestamptz,
  end_time timestamptz,
  duration_seconds integer,
  completion_percentage numeric
) AS $$
DECLARE
  v_created_count integer := 0;
  v_user_id uuid;
  v_resort_id uuid;
  v_segment_record record;
  v_descent_session_id uuid;
  v_last_segment_end timestamptz;
  v_gap_threshold interval := '5 minutes'; -- If segments are more than 5 minutes apart, start new descent
  v_sequence_order integer;
BEGIN
  -- Get user_id and resort_id from session
  SELECT user_id, resort_id INTO v_user_id, v_resort_id
  FROM ski_sessions
  WHERE id = p_session_id;
  
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Session not found: %', p_session_id;
  END IF;
  
  -- Initialize tracking variables
  v_descent_session_id := NULL;
  v_last_segment_end := NULL;
  v_sequence_order := 0;
  
  -- Use a CTE-based approach to find segments
  -- This processes all location points and groups them into segments near runs
  FOR v_segment_record IN
    WITH location_points AS (
      SELECT 
        lh.id,
        lh.latitude,
        lh.longitude,
        lh.recorded_at,
        lh.speed_kmh,
        lh.altitude_meters,
        ROW_NUMBER() OVER (ORDER BY lh.recorded_at) as point_num
      FROM location_history lh
      WHERE lh.session_id = p_session_id
        AND lh.speed_kmh > 3 -- Only moving points
      ORDER BY lh.recorded_at
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
            -- For MultiLineString, use first line for initial filtering
            sf.geometry->'coordinates'->0
          ELSE NULL
        END as line_coords,
        CASE
          WHEN sf.geometry->>'type' = 'LineString' AND jsonb_array_length(sf.geometry->'coordinates') > 0 THEN
            sf.geometry->'coordinates'->0
          WHEN sf.geometry->>'type' = 'MultiLineString' THEN
            (sf.geometry->'coordinates'->0->0)
          ELSE NULL
        END as first_coord
      FROM ski_features sf
      WHERE sf.resort_id = v_resort_id
        AND sf.type = 'trail'
        AND sf.active = true
        AND sf.geometry IS NOT NULL
    ),
    point_to_run_distances AS (
      SELECT 
        lp.*,
        rg.run_id,
        rg.run_name,
        rg.geometry as run_geometry,
        CASE
          WHEN rg.line_coords IS NOT NULL THEN
            find_closest_point_on_line(lp.latitude, lp.longitude, rg.line_coords)
          ELSE 999999
        END as distance_to_run
      FROM location_points lp
      CROSS JOIN run_geometries rg
      WHERE rg.line_coords IS NOT NULL
        AND rg.first_coord IS NOT NULL
        -- Pre-filter: only check runs roughly in the same area (within 500m)
        AND haversine_distance(
          lp.latitude, 
          lp.longitude,
          (rg.first_coord->>1)::numeric,
          (rg.first_coord->>0)::numeric
        ) < 500
    ),
    closest_runs AS (
      SELECT DISTINCT ON (point_to_run_distances.id)
        point_to_run_distances.*
      FROM point_to_run_distances
      WHERE point_to_run_distances.distance_to_run <= p_proximity_threshold
      ORDER BY point_to_run_distances.id, point_to_run_distances.distance_to_run ASC
    ),
    run_with_lag AS (
      SELECT 
        cr.*,
        LAG(cr.run_id) OVER (ORDER BY cr.recorded_at) as prev_run_id
      FROM closest_runs cr
    ),
    run_groups AS (
      SELECT 
        rwl.*,
        -- Create groups for consecutive points on same run
        SUM(CASE 
          WHEN rwl.prev_run_id = rwl.run_id 
            AND rwl.prev_run_id IS NOT NULL
          THEN 0 
          ELSE 1 
        END) OVER (ORDER BY rwl.recorded_at) as segment_group
      FROM run_with_lag rwl
    ),
    segments AS (
      SELECT 
        rg.run_id,
        rg.run_name,
        (array_agg(rg.run_geometry))[1] as run_geometry, -- All should be same, just take first
        MIN(rg.recorded_at) as segment_start,
        MAX(rg.recorded_at) as segment_end,
        COUNT(*) as point_count,
        -- Build GPS track coordinates
        jsonb_agg(
          jsonb_build_array(
            rg.longitude,
            rg.latitude,
            COALESCE(rg.altitude_meters, 0)
          )
          ORDER BY rg.recorded_at
        ) as gps_coords,
        MAX(rg.speed_kmh) as top_speed,
        AVG(rg.speed_kmh) as avg_speed
      FROM run_groups rg
      GROUP BY rg.run_id, rg.run_name, rg.segment_group
      HAVING COUNT(*) >= p_min_points
        AND EXTRACT(EPOCH FROM (MAX(rg.recorded_at) - MIN(rg.recorded_at))) >= p_min_duration_seconds
    )
    SELECT 
      s.run_id,
      s.run_name,
      s.run_geometry,
      s.segment_start,
      s.segment_end,
      EXTRACT(EPOCH FROM (s.segment_end - s.segment_start))::integer as duration_seconds,
      s.gps_coords,
      s.top_speed,
      s.avg_speed,
      s.point_count
    FROM segments s
    -- Exclude segments that already have a completion
    WHERE NOT EXISTS (
      SELECT 1
      FROM run_completions rc
      WHERE rc.session_id = p_session_id
        AND rc.ski_feature_id = s.run_id
        AND ABS(EXTRACT(EPOCH FROM (rc.started_at - s.segment_start))) < 60 -- Within 1 minute
    )
    ORDER BY s.segment_start
  LOOP
    -- Build GPS track GeoJSON
    DECLARE
      v_gps_track jsonb;
      v_completion_percentage numeric;
    BEGIN
      v_gps_track := jsonb_build_object(
        'type', 'LineString',
        'coordinates', v_segment_record.gps_coords
      );
      
      -- Calculate completion percentage
      SELECT calculate_completion_percentage_for_track(
        v_gps_track,
        v_segment_record.run_geometry
      ) INTO v_completion_percentage;
      
      -- Check if we need to start a new descent session
      -- New descent if:
      -- 1. No current descent session, OR
      -- 2. Gap between segments is > threshold (user likely took a lift up)
      IF v_descent_session_id IS NULL OR 
         (v_last_segment_end IS NOT NULL AND 
          v_segment_record.segment_start - v_last_segment_end > v_gap_threshold) THEN
        
        -- End previous descent session if it exists
        IF v_descent_session_id IS NOT NULL THEN
          PERFORM end_descent_session(v_descent_session_id, v_user_id);
        END IF;
        
        -- Create new descent session
        INSERT INTO descent_sessions (
          session_id,
          user_id,
          started_at,
          is_active,
          total_segments
        )
        VALUES (
          p_session_id,
          v_user_id,
          v_segment_record.segment_start,
          true, -- Active until we finish processing
          0 -- Will be updated later
        )
        RETURNING id INTO v_descent_session_id;
        
        v_sequence_order := 0;
      END IF;
      
      -- Create run completion
      INSERT INTO run_completions (
        session_id,
        user_id,
        ski_feature_id,
        started_at,
        completed_at,
        duration_seconds,
        top_speed_kmh,
        avg_speed_kmh,
        gps_track,
        detection_method,
        descent_session_id,
        segment_type,
        sequence_order,
        completion_percentage
      ) VALUES (
        p_session_id,
        v_user_id,
        v_segment_record.run_id,
        v_segment_record.segment_start,
        v_segment_record.segment_end,
        v_segment_record.duration_seconds,
        v_segment_record.top_speed,
        v_segment_record.avg_speed,
        v_gps_track,
        'retroactive_detection',
        v_descent_session_id,
        'on_trail',
        v_sequence_order,
        v_completion_percentage
      );
      
      v_created_count := v_created_count + 1;
      v_sequence_order := v_sequence_order + 1;
      v_last_segment_end := v_segment_record.segment_end;
      
      -- Return info about created completion
      RETURN QUERY SELECT 
        v_created_count,
        v_segment_record.run_id,
        v_segment_record.run_name,
        v_segment_record.segment_start,
        v_segment_record.segment_end,
        v_segment_record.duration_seconds,
        v_completion_percentage;
    END;
  END LOOP;
  
  -- End the last descent session if we created any completions
  IF v_descent_session_id IS NOT NULL THEN
    PERFORM end_descent_session(v_descent_session_id, v_user_id);
  END IF;
  
  RETURN;
END;
$$ LANGUAGE plpgsql;

-- Helper function to calculate completion percentage for a GPS track
CREATE OR REPLACE FUNCTION calculate_completion_percentage_for_track(
  p_gps_track jsonb,
  p_run_geometry jsonb
)
RETURNS numeric AS $$
DECLARE
  v_coords jsonb;
  v_num_coords integer;
  v_point_lat numeric;
  v_point_lon numeric;
  v_progress numeric;
  v_min_progress numeric := 1.0;
  v_max_progress numeric := 0.0;
  v_completion_percentage numeric;
  v_sample_interval integer := 1;
  i integer;
BEGIN
  IF p_gps_track IS NULL OR p_run_geometry IS NULL THEN
    RETURN NULL;
  END IF;
  
  IF p_gps_track->>'type' != 'LineString' THEN
    RETURN NULL;
  END IF;
  
  v_coords := p_gps_track->'coordinates';
  v_num_coords := jsonb_array_length(v_coords);
  
  IF v_num_coords < 2 THEN
    RETURN NULL;
  END IF;
  
  IF v_num_coords > 50 THEN
    v_sample_interval := GREATEST(1, v_num_coords / 50);
  END IF;
  
  -- Sample points and find min/max progress
  FOR i IN 0..v_num_coords - 1 BY v_sample_interval LOOP
    v_point_lon := (v_coords->i->>0)::numeric;
    v_point_lat := (v_coords->i->>1)::numeric;
    
    v_progress := find_progress_on_run(v_point_lat, v_point_lon, p_run_geometry);
    
    IF v_progress < v_min_progress THEN
      v_min_progress := v_progress;
    END IF;
    IF v_progress > v_max_progress THEN
      v_max_progress := v_progress;
    END IF;
  END LOOP;
  
  -- Always check first and last points
  v_point_lon := (v_coords->0->>0)::numeric;
  v_point_lat := (v_coords->0->>1)::numeric;
  v_progress := find_progress_on_run(v_point_lat, v_point_lon, p_run_geometry);
  IF v_progress < v_min_progress THEN v_min_progress := v_progress; END IF;
  IF v_progress > v_max_progress THEN v_max_progress := v_progress; END IF;
  
  v_point_lon := (v_coords->(v_num_coords - 1)->>0)::numeric;
  v_point_lat := (v_coords->(v_num_coords - 1)->>1)::numeric;
  v_progress := find_progress_on_run(v_point_lat, v_point_lon, p_run_geometry);
  IF v_progress < v_min_progress THEN v_min_progress := v_progress; END IF;
  IF v_progress > v_max_progress THEN v_max_progress := v_progress; END IF;
  
  v_completion_percentage := (v_max_progress - v_min_progress) * 100;
  v_completion_percentage := GREATEST(0, LEAST(100, v_completion_percentage));
  
  RETURN v_completion_percentage;
END;
$$ LANGUAGE plpgsql IMMUTABLE;
