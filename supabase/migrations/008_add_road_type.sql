-- Add 'road' type to ski_features table
-- This allows roads to be stored alongside trails, lifts, boundaries, and areas

-- Drop the existing constraint
ALTER TABLE ski_features DROP CONSTRAINT IF EXISTS ski_features_type_check;

-- Add new constraint that includes 'road'
ALTER TABLE ski_features ADD CONSTRAINT ski_features_type_check 
  CHECK (type IN ('trail', 'lift', 'boundary', 'area', 'road'));

