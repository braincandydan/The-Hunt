-- Recalculate descent session times from their segments
-- This fixes descent sessions that have incorrect started_at/ended_at times

CREATE OR REPLACE FUNCTION recalculate_descent_session_times()
RETURNS void AS $$
DECLARE
  v_descent_record RECORD;
  v_started_at timestamptz;
  v_ended_at timestamptz;
BEGIN
  -- Loop through all descent sessions
  FOR v_descent_record IN
    SELECT id, session_id, user_id
    FROM descent_sessions
  LOOP
    -- Get the actual start time from the first segment's started_at
    SELECT MIN(started_at) INTO v_started_at
    FROM run_completions
    WHERE descent_session_id = v_descent_record.id;
    
    -- Get the actual end time from the last segment's completed_at
    SELECT MAX(completed_at) INTO v_ended_at
    FROM run_completions
    WHERE descent_session_id = v_descent_record.id;
    
    -- Update the descent session with correct times
    IF v_started_at IS NOT NULL AND v_ended_at IS NOT NULL THEN
      UPDATE descent_sessions
      SET 
        started_at = v_started_at,
        ended_at = v_ended_at,
        total_segments = (
          SELECT COUNT(*) 
          FROM run_completions 
          WHERE descent_session_id = v_descent_record.id
        ),
        top_speed_kmh = (
          SELECT COALESCE(MAX(top_speed_kmh), 0) 
          FROM run_completions 
          WHERE descent_session_id = v_descent_record.id
        ),
        avg_speed_kmh = (
          SELECT COALESCE(AVG(avg_speed_kmh), 0)
          FROM run_completions
          WHERE descent_session_id = v_descent_record.id
          AND avg_speed_kmh IS NOT NULL
        )
      WHERE id = v_descent_record.id;
    END IF;
  END LOOP;
  
  RAISE NOTICE 'Recalculated descent session times from segment data';
END;
$$ LANGUAGE plpgsql;

-- Run the recalculation
SELECT recalculate_descent_session_times();

