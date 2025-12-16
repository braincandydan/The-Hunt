-- Migration to retroactively create descent sessions from existing run completion data
-- This groups runs that were completed close together in time into descent sessions

-- Function to create descent sessions from existing data
CREATE OR REPLACE FUNCTION retroactively_create_descent_sessions()
RETURNS void AS $$
DECLARE
  v_session_record RECORD;
  v_completion_record RECORD;
  v_descent_id uuid;
  v_sequence_order integer;
  v_gap_threshold interval := '5 minutes'; -- If runs are more than 5 minutes apart, start new descent
  v_last_completion_time timestamptz;
BEGIN
  -- Loop through each ski session
  FOR v_session_record IN 
    SELECT DISTINCT session_id 
    FROM run_completions 
    WHERE descent_session_id IS NULL
      AND ski_feature_id IS NOT NULL -- Only process runs with ski_feature_id (exclude off-trail segments)
    ORDER BY session_id
  LOOP
    v_sequence_order := 0;
    v_last_completion_time := NULL;
    v_descent_id := NULL;
    
    -- Process completions for this session in chronological order
    FOR v_completion_record IN
      SELECT *
      FROM run_completions
      WHERE session_id = v_session_record.session_id
        AND descent_session_id IS NULL
        AND ski_feature_id IS NOT NULL -- Only process runs with ski_feature_id
        AND (segment_type IS NULL OR segment_type = 'on_trail') -- Only process on-trail runs for now
      ORDER BY started_at ASC, completed_at ASC -- Order by start time first, then completion time
    LOOP
      -- Check if we need to start a new descent session
      -- New descent if:
      -- 1. No current descent session, OR
      -- 2. Gap between runs is > threshold (user likely took a lift up)
      --    Use started_at of current run vs completed_at of previous run
      IF v_descent_id IS NULL OR 
         (v_last_completion_time IS NOT NULL AND 
          v_completion_record.started_at - v_last_completion_time > v_gap_threshold) THEN
        
        -- Create new descent session
        INSERT INTO descent_sessions (
          session_id,
          user_id,
          started_at,
          is_active,
          total_segments
        )
        VALUES (
          v_session_record.session_id,
          v_completion_record.user_id,
          v_completion_record.started_at,
          false, -- All retroactive sessions are inactive
          0 -- Will be updated later
        )
        RETURNING id INTO v_descent_id;
        
        v_sequence_order := 0;
      END IF;
      
      -- Update the completion with descent session info
      UPDATE run_completions
      SET 
        descent_session_id = v_descent_id,
        sequence_order = v_sequence_order,
        segment_type = COALESCE(segment_type, 'on_trail')
      WHERE id = v_completion_record.id;
      
      v_sequence_order := v_sequence_order + 1;
      v_last_completion_time := v_completion_record.completed_at;
    END LOOP;
    
    -- Update descent session stats
    IF v_descent_id IS NOT NULL THEN
      UPDATE descent_sessions
      SET 
        ended_at = v_last_completion_time,
        total_segments = (
          SELECT COUNT(*) 
          FROM run_completions 
          WHERE descent_session_id = v_descent_id
        ),
        top_speed_kmh = (
          SELECT COALESCE(MAX(top_speed_kmh), 0)
          FROM run_completions
          WHERE descent_session_id = v_descent_id
        ),
        avg_speed_kmh = (
          SELECT COALESCE(AVG(avg_speed_kmh), 0)
          FROM run_completions
          WHERE descent_session_id = v_descent_id
          AND avg_speed_kmh IS NOT NULL
        )
      WHERE id = v_descent_id;
    END IF;
  END LOOP;
  
  RAISE NOTICE 'Retroactively created descent sessions from existing run completion data';
END;
$$ LANGUAGE plpgsql;

-- Run the function to create descent sessions
SELECT retroactively_create_descent_sessions();

-- Drop the function after use (optional - you can keep it if you want to re-run it)
-- DROP FUNCTION retroactively_create_descent_sessions();

