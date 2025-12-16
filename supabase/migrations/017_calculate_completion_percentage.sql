-- Calculate completion_percentage for existing run_completions
-- This migration retroactively calculates completion percentage based on GPS tracks and run geometries
--
-- The completion percentage is calculated by:
-- 1. Sampling points from the GPS track
-- 2. Finding the progress (0-1) of each point along the run's geometry
-- 3. Calculating the range: (maxProgress - minProgress) * 100
--
-- This gives an accurate representation of how much of the run was traversed,
-- even if the user started in the middle or went back and forth.
--
-- To manually recalculate for a specific completion:
--   SELECT calculate_completion_percentage('completion-id-here');
--
-- To recalculate all completions:
--   UPDATE run_completions rc
--   SET completion_percentage = calculate_completion_percentage(rc.id)
--   WHERE rc.ski_feature_id IS NOT NULL AND rc.gps_track IS NOT NULL;

-- Function to find the progress (0-1) of a point along a run's geometry
-- Returns the position along the run where the point is closest
CREATE OR REPLACE FUNCTION find_progress_on_run(
  point_lat numeric,
  point_lon numeric,
  run_geometry jsonb
)
RETURNS numeric AS $$
DECLARE
  coords jsonb;
  coord_array jsonb;
  min_distance numeric := 999999999;
  closest_progress numeric := 0;
  i integer;
  j integer;
  lat1 numeric;
  lon1 numeric;
  lat2 numeric;
  lon2 numeric;
  segment_length numeric;
  dx numeric;
  dy numeric;
  t numeric;
  closest_lat numeric;
  closest_lon numeric;
  distance numeric;
  total_segments integer;
  current_segment integer;
  progress_along_segment numeric;
BEGIN
  -- Handle LineString
  IF run_geometry->>'type' = 'LineString' THEN
    coords := run_geometry->'coordinates';
    total_segments := jsonb_array_length(coords) - 1;
    
    IF total_segments <= 0 THEN
      RETURN 0;
    END IF;
    
    -- Find closest point on any segment
    FOR i IN 0..total_segments - 1 LOOP
      lat1 := (coords->i->>1)::numeric;
      lon1 := (coords->i->>0)::numeric;
      lat2 := (coords->(i+1)->>1)::numeric;
      lon2 := (coords->(i+1)->>0)::numeric;
      
      -- Calculate segment length
      segment_length := haversine_distance(lat1, lon1, lat2, lon2);
      IF segment_length = 0 THEN
        CONTINUE;
      END IF;
      
      -- Project point onto segment
      dx := lon2 - lon1;
      dy := lat2 - lat1;
      t := GREATEST(0, LEAST(1,
        ((point_lon - lon1) * dx + (point_lat - lat1) * dy) / (dx * dx + dy * dy)
      ));
      
      closest_lon := lon1 + t * dx;
      closest_lat := lat1 + t * dy;
      distance := haversine_distance(point_lat, point_lon, closest_lat, closest_lon);
      
      IF distance < min_distance THEN
        min_distance := distance;
        current_segment := i;
        progress_along_segment := t;
        closest_progress := (i::numeric + t) / total_segments::numeric;
      END IF;
    END LOOP;
    
    RETURN closest_progress;
    
  -- Handle MultiLineString
  ELSIF run_geometry->>'type' = 'MultiLineString' THEN
    coord_array := run_geometry->'coordinates';
    total_segments := 0;
    
    -- Calculate total segments across all lines
    FOR i IN 0..jsonb_array_length(coord_array) - 1 LOOP
      coords := coord_array->i;
      total_segments := total_segments + jsonb_array_length(coords) - 1;
    END LOOP;
    
    IF total_segments <= 0 THEN
      RETURN 0;
    END IF;
    
    -- Find closest point across all line strings
    current_segment := 0;
    FOR i IN 0..jsonb_array_length(coord_array) - 1 LOOP
      coords := coord_array->i;
      FOR j IN 0..jsonb_array_length(coords) - 2 LOOP
        lat1 := (coords->j->>1)::numeric;
        lon1 := (coords->j->>0)::numeric;
        lat2 := (coords->(j+1)->>1)::numeric;
        lon2 := (coords->(j+1)->>0)::numeric;
        
        segment_length := haversine_distance(lat1, lon1, lat2, lon2);
        IF segment_length = 0 THEN
          CONTINUE;
        END IF;
        
        dx := lon2 - lon1;
        dy := lat2 - lat1;
        t := GREATEST(0, LEAST(1,
          ((point_lon - lon1) * dx + (point_lat - lat1) * dy) / (dx * dx + dy * dy)
        ));
        
        closest_lon := lon1 + t * dx;
        closest_lat := lat1 + t * dy;
        distance := haversine_distance(point_lat, point_lon, closest_lat, closest_lon);
        
        IF distance < min_distance THEN
          min_distance := distance;
          progress_along_segment := t;
          closest_progress := (current_segment::numeric + t) / total_segments::numeric;
        END IF;
        
        current_segment := current_segment + 1;
      END LOOP;
    END LOOP;
    
    RETURN closest_progress;
  END IF;
  
  RETURN 0;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Function to calculate completion percentage for a single run completion
-- Samples multiple points from the GPS track to find min/max progress
CREATE OR REPLACE FUNCTION calculate_completion_percentage(
  p_completion_id uuid
)
RETURNS numeric AS $$
DECLARE
  v_gps_track jsonb;
  v_run_geometry jsonb;
  v_coords jsonb;
  v_num_coords integer;
  v_point_lat numeric;
  v_point_lon numeric;
  v_progress numeric;
  v_min_progress numeric := 1.0;
  v_max_progress numeric := 0.0;
  v_completion_percentage numeric;
  v_sample_interval integer := 1; -- Sample every Nth point (1 = all points)
  i integer;
BEGIN
  -- Get GPS track and run geometry
  SELECT 
    rc.gps_track,
    sf.geometry
  INTO
    v_gps_track,
    v_run_geometry
  FROM run_completions rc
  JOIN ski_features sf ON rc.ski_feature_id = sf.id
  WHERE rc.id = p_completion_id
    AND rc.ski_feature_id IS NOT NULL
    AND rc.gps_track IS NOT NULL
    AND rc.gps_track->>'type' = 'LineString'
    AND jsonb_array_length(rc.gps_track->'coordinates') >= 2;
  
  -- If no valid data, return NULL
  IF v_gps_track IS NULL OR v_run_geometry IS NULL THEN
    RETURN NULL;
  END IF;
  
  v_coords := v_gps_track->'coordinates';
  v_num_coords := jsonb_array_length(v_coords);
  
  -- If we have many points, sample every Nth point for performance
  IF v_num_coords > 50 THEN
    v_sample_interval := GREATEST(1, v_num_coords / 50);
  END IF;
  
  -- Sample points from GPS track and find min/max progress
  FOR i IN 0..v_num_coords - 1 BY v_sample_interval LOOP
    v_point_lon := (v_coords->i->>0)::numeric;
    v_point_lat := (v_coords->i->>1)::numeric;
    
    -- Find progress of this point on the run
    v_progress := find_progress_on_run(v_point_lat, v_point_lon, v_run_geometry);
    
    -- Update min/max
    IF v_progress < v_min_progress THEN
      v_min_progress := v_progress;
    END IF;
    IF v_progress > v_max_progress THEN
      v_max_progress := v_progress;
    END IF;
  END LOOP;
  
  -- Always include first and last points
  v_point_lon := (v_coords->0->>0)::numeric;
  v_point_lat := (v_coords->0->>1)::numeric;
  v_progress := find_progress_on_run(v_point_lat, v_point_lon, v_run_geometry);
  IF v_progress < v_min_progress THEN
    v_min_progress := v_progress;
  END IF;
  IF v_progress > v_max_progress THEN
    v_max_progress := v_progress;
  END IF;
  
  v_point_lon := (v_coords->(v_num_coords - 1)->>0)::numeric;
  v_point_lat := (v_coords->(v_num_coords - 1)->>1)::numeric;
  v_progress := find_progress_on_run(v_point_lat, v_point_lon, v_run_geometry);
  IF v_progress < v_min_progress THEN
    v_min_progress := v_progress;
  END IF;
  IF v_progress > v_max_progress THEN
    v_max_progress := v_progress;
  END IF;
  
  -- Calculate completion percentage as the range of progress covered
  v_completion_percentage := (v_max_progress - v_min_progress) * 100;
  
  -- Clamp to 0-100
  v_completion_percentage := GREATEST(0, LEAST(100, v_completion_percentage));
  
  RETURN v_completion_percentage;
END;
$$ LANGUAGE plpgsql;

-- Update all existing run_completions with calculated completion_percentage
UPDATE run_completions rc
SET completion_percentage = calculate_completion_percentage(rc.id)
WHERE 
  rc.ski_feature_id IS NOT NULL
  AND rc.gps_track IS NOT NULL
  AND rc.completion_percentage IS NULL
  AND EXISTS (
    SELECT 1 FROM ski_features sf 
    WHERE sf.id = rc.ski_feature_id 
    AND sf.geometry IS NOT NULL
  );

-- For off-trail segments or completions without GPS tracks, set to NULL (already NULL)
-- No action needed as they're already NULL

