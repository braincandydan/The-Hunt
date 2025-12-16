-- Split descent sessions that incorrectly group runs with large time gaps
-- This function will find descent sessions where runs have gaps > 5 minutes
-- and split them into separate descent sessions

CREATE OR REPLACE FUNCTION split_incorrect_descent_sessions(
  p_gap_threshold interval DEFAULT '5 minutes'
)
RETURNS TABLE(
  split_count integer,
  original_descent_id uuid,
  new_descent_ids uuid[]
) AS $$
DECLARE
  v_descent_record RECORD;
  v_completion_record RECORD;
  v_new_descent_id uuid;
  v_last_completion_time timestamptz;
  v_sequence_order integer;
  v_split_count integer := 0;
  v_new_descent_ids uuid[] := ARRAY[]::uuid[];
  v_original_descent_id uuid;
BEGIN
  -- Loop through all descent sessions
  FOR v_descent_record IN
    SELECT 
      ds.id,
      ds.session_id,
      ds.user_id
    FROM descent_sessions ds
    WHERE ds.is_active = false -- Only process completed descents
    ORDER BY ds.started_at
  LOOP
    v_original_descent_id := v_descent_record.id;
    v_new_descent_ids := ARRAY[]::uuid[];
    v_last_completion_time := NULL;
    v_new_descent_id := NULL;
    v_sequence_order := 0;
    
    -- Get all completions for this descent, ordered by time
    FOR v_completion_record IN
      SELECT *
      FROM run_completions
      WHERE descent_session_id = v_descent_record.id
      ORDER BY started_at ASC, completed_at ASC
    LOOP
      -- Check if we need to start a new descent session
      -- New descent if:
      -- 1. No current descent session, OR
      -- 2. Gap between runs is > threshold
      IF v_new_descent_id IS NULL OR 
         (v_last_completion_time IS NOT NULL AND 
          v_completion_record.started_at - v_last_completion_time > p_gap_threshold) THEN
        
        -- If this is not the first segment and we're creating a new descent,
        -- we need to split the original descent
        IF v_new_descent_id IS NOT NULL THEN
          -- This means we found a gap, so we need to split
          -- The previous segments stay in the original descent (or a new one we created)
          -- This segment starts a new descent
        END IF;
        
        -- Create new descent session for this segment
        INSERT INTO descent_sessions (
          session_id,
          user_id,
          started_at,
          is_active,
          total_segments
        )
        VALUES (
          v_descent_record.session_id,
          v_descent_record.user_id,
          v_completion_record.started_at,
          false,
          0
        )
        RETURNING id INTO v_new_descent_id;
        
        v_new_descent_ids := array_append(v_new_descent_ids, v_new_descent_id);
        v_sequence_order := 0;
        v_split_count := v_split_count + 1;
      END IF;
      
      -- Update the completion to point to the new descent session
      -- (if it's different from the original)
      IF v_new_descent_id != v_descent_record.id THEN
        UPDATE run_completions
        SET 
          descent_session_id = v_new_descent_id,
          sequence_order = v_sequence_order
        WHERE id = v_completion_record.id;
      END IF;
      
      v_sequence_order := v_sequence_order + 1;
      v_last_completion_time := v_completion_record.completed_at;
    END LOOP;
    
    -- If we created new descent sessions, we need to handle the original
    -- If the first segment is in a new descent, we can delete the original
    -- Otherwise, we need to update the original to only include its segments
    IF array_length(v_new_descent_ids, 1) > 0 THEN
      -- Check if original descent still has any segments
      IF NOT EXISTS (
        SELECT 1 
        FROM run_completions 
        WHERE descent_session_id = v_descent_record.id
      ) THEN
        -- Original descent has no segments, delete it
        DELETE FROM descent_sessions WHERE id = v_descent_record.id;
      ELSE
        -- Original descent still has segments, recalculate its times
        PERFORM end_descent_session(v_descent_record.id, v_descent_record.user_id);
      END IF;
      
      -- Recalculate times for all new descent sessions
      FOR v_new_descent_id IN SELECT unnest(v_new_descent_ids)
      LOOP
        PERFORM end_descent_session(v_new_descent_id, v_descent_record.user_id);
      END LOOP;
      
      -- Return info about the split
      RETURN QUERY SELECT 
        v_split_count,
        v_original_descent_id,
        v_new_descent_ids;
    END IF;
  END LOOP;
  
  RETURN;
END;
$$ LANGUAGE plpgsql;

-- Also create a simpler function that just recalculates all descent session times
-- and splits any that have gaps > threshold
CREATE OR REPLACE FUNCTION fix_all_descent_sessions(
  p_gap_threshold interval DEFAULT '5 minutes'
)
RETURNS void AS $$
DECLARE
  v_descent_record RECORD;
  v_completion_record RECORD;
  v_new_descent_id uuid;
  v_last_completion_time timestamptz;
  v_sequence_order integer;
  v_started_at timestamptz;
  v_ended_at timestamptz;
BEGIN
  -- First, clear all descent_session_id associations
  -- We'll rebuild them properly
  UPDATE run_completions
  SET descent_session_id = NULL, sequence_order = NULL
  WHERE descent_session_id IS NOT NULL;
  
  -- Delete all existing descent sessions (we'll recreate them)
  DELETE FROM descent_sessions;
  
  -- Now recreate descent sessions properly, grouped by session_id and time gaps
  FOR v_descent_record IN
    SELECT DISTINCT 
      session_id,
      user_id
    FROM run_completions
    WHERE ski_feature_id IS NOT NULL -- Only process runs
    ORDER BY session_id
  LOOP
    v_last_completion_time := NULL;
    v_new_descent_id := NULL;
    v_sequence_order := 0;
    
    -- Process all completions for this session in chronological order
    FOR v_completion_record IN
      SELECT *
      FROM run_completions
      WHERE session_id = v_descent_record.session_id
        AND ski_feature_id IS NOT NULL
      ORDER BY started_at ASC, completed_at ASC
    LOOP
      -- Check if we need to start a new descent session
      IF v_new_descent_id IS NULL OR 
         (v_last_completion_time IS NOT NULL AND 
          v_completion_record.started_at - v_last_completion_time > p_gap_threshold) THEN
        
        -- End previous descent session if it exists
        IF v_new_descent_id IS NOT NULL THEN
          -- Get times from segments
          SELECT MIN(started_at), MAX(completed_at)
          INTO v_started_at, v_ended_at
          FROM run_completions
          WHERE descent_session_id = v_new_descent_id;
          
          UPDATE descent_sessions
          SET 
            started_at = v_started_at,
            ended_at = v_ended_at,
            is_active = false,
            total_segments = (
              SELECT COUNT(*) FROM run_completions WHERE descent_session_id = v_new_descent_id
            ),
            top_speed_kmh = (
              SELECT COALESCE(MAX(top_speed_kmh), 0) 
              FROM run_completions WHERE descent_session_id = v_new_descent_id
            ),
            avg_speed_kmh = (
              SELECT COALESCE(AVG(avg_speed_kmh), 0)
              FROM run_completions
              WHERE descent_session_id = v_new_descent_id
              AND avg_speed_kmh IS NOT NULL
            )
          WHERE id = v_new_descent_id;
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
          v_descent_record.session_id,
          v_descent_record.user_id,
          v_completion_record.started_at,
          true,
          0
        )
        RETURNING id INTO v_new_descent_id;
        
        v_sequence_order := 0;
      END IF;
      
      -- Associate completion with descent session
      UPDATE run_completions
      SET 
        descent_session_id = v_new_descent_id,
        sequence_order = v_sequence_order
      WHERE id = v_completion_record.id;
      
      v_sequence_order := v_sequence_order + 1;
      v_last_completion_time := v_completion_record.completed_at;
    END LOOP;
    
    -- End the last descent session for this session
    IF v_new_descent_id IS NOT NULL THEN
      SELECT MIN(started_at), MAX(completed_at)
      INTO v_started_at, v_ended_at
      FROM run_completions
      WHERE descent_session_id = v_new_descent_id;
      
      UPDATE descent_sessions
      SET 
        started_at = v_started_at,
        ended_at = v_ended_at,
        is_active = false,
        total_segments = (
          SELECT COUNT(*) FROM run_completions WHERE descent_session_id = v_new_descent_id
        ),
        top_speed_kmh = (
          SELECT COALESCE(MAX(top_speed_kmh), 0) 
          FROM run_completions WHERE descent_session_id = v_new_descent_id
        ),
        avg_speed_kmh = (
          SELECT COALESCE(AVG(avg_speed_kmh), 0)
          FROM run_completions
          WHERE descent_session_id = v_new_descent_id
          AND avg_speed_kmh IS NOT NULL
        )
      WHERE id = v_new_descent_id;
    END IF;
  END LOOP;
  
  RAISE NOTICE 'Fixed all descent sessions by regrouping runs with proper time gaps';
END;
$$ LANGUAGE plpgsql;

