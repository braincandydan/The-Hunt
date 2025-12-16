-- Diagnostic function to identify runs that are not associated with descent sessions
-- This helps understand why some runs aren't showing up in descent segments

CREATE OR REPLACE FUNCTION diagnose_unassociated_runs(p_session_id uuid DEFAULT NULL)
RETURNS TABLE(
  completion_id uuid,
  session_id uuid,
  ski_feature_id uuid,
  run_name text,
  started_at timestamptz,
  completed_at timestamptz,
  descent_session_id uuid,
  segment_type text,
  sequence_order integer,
  time_since_previous timestamptz,
  gap_minutes numeric,
  reason text
) AS $$
BEGIN
  RETURN QUERY
  WITH ordered_completions AS (
    SELECT 
      rc.id,
      rc.session_id,
      rc.ski_feature_id,
      sf.name as run_name,
      rc.started_at,
      rc.completed_at,
      rc.descent_session_id,
      rc.segment_type,
      rc.sequence_order,
      LAG(rc.completed_at) OVER (PARTITION BY rc.session_id ORDER BY rc.completed_at) as prev_completed_at,
      LAG(rc.id) OVER (PARTITION BY rc.session_id ORDER BY rc.completed_at) as prev_completion_id
    FROM run_completions rc
    LEFT JOIN ski_features sf ON rc.ski_feature_id = sf.id
    WHERE (p_session_id IS NULL OR rc.session_id = p_session_id)
      AND (rc.segment_type IS NULL OR rc.segment_type = 'on_trail') -- Only on-trail runs
      AND rc.ski_feature_id IS NOT NULL -- Exclude off-trail segments
  )
  SELECT 
    oc.id as completion_id,
    oc.session_id,
    oc.ski_feature_id,
    oc.run_name,
    oc.started_at,
    oc.completed_at,
    oc.descent_session_id,
    oc.segment_type,
    oc.sequence_order,
    oc.prev_completed_at as time_since_previous,
    CASE 
      WHEN oc.prev_completed_at IS NOT NULL THEN
        EXTRACT(EPOCH FROM (oc.started_at - oc.prev_completed_at)) / 60.0
      ELSE NULL
    END as gap_minutes,
    CASE
      WHEN oc.descent_session_id IS NULL AND oc.prev_completed_at IS NULL THEN
        'First run in session - should start a descent'
      WHEN oc.descent_session_id IS NULL AND oc.prev_completed_at IS NOT NULL THEN
        CASE
          WHEN EXTRACT(EPOCH FROM (oc.started_at - oc.prev_completed_at)) / 60.0 > 5 THEN
            'Gap > 5 minutes from previous run - should start new descent'
          ELSE
            'Gap <= 5 minutes - should be in same descent as previous'
        END
      WHEN oc.descent_session_id IS NOT NULL THEN
        'Already associated with descent session'
      ELSE
        'Unknown reason'
    END as reason
  FROM ordered_completions oc
  ORDER BY oc.session_id, oc.completed_at;
END;
$$ LANGUAGE plpgsql;

-- Example usage:
-- SELECT * FROM diagnose_unassociated_runs(); -- All sessions
-- SELECT * FROM diagnose_unassociated_runs('your-session-id-here'); -- Specific session

