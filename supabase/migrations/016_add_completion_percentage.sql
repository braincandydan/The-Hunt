-- Add completion_percentage field to run_completions table
ALTER TABLE run_completions
  ADD COLUMN IF NOT EXISTS completion_percentage numeric(5, 2);

-- Add comment explaining the field
COMMENT ON COLUMN run_completions.completion_percentage IS 'Percentage of the run completed (0-100). For partial runs, this shows how much of the run was traversed.';

-- Create index for filtering by completion percentage
CREATE INDEX IF NOT EXISTS idx_run_completions_completion_percentage ON run_completions(completion_percentage);

