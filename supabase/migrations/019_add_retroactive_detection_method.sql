-- Add 'retroactive_detection' to the allowed detection_method values
-- This allows the retroactively_detect_runs function to create run_completions

-- Drop the existing check constraint
ALTER TABLE run_completions
  DROP CONSTRAINT IF EXISTS run_completions_detection_method_check;

-- Add the constraint back with the new value
ALTER TABLE run_completions
  ADD CONSTRAINT run_completions_detection_method_check 
  CHECK (detection_method IN ('gps_proximity', 'manual', 'qr_scan', 'retroactive_detection'));

