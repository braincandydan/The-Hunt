-- Enable PostGIS extension for geospatial data (if available)
-- If PostGIS is not available, we'll use GeoJSON stored as JSONB
-- CREATE EXTENSION IF NOT EXISTS postgis;

-- Ski features table (trails, lifts, boundaries)
CREATE TABLE ski_features (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  resort_id uuid REFERENCES resorts(id) ON DELETE CASCADE NOT NULL,
  name text NOT NULL,
  type text NOT NULL CHECK (type IN ('trail', 'lift', 'boundary', 'area')),
  difficulty text CHECK (difficulty IN ('green', 'blue', 'black', 'double-black', 'terrain-park', 'other')),
  -- GeoJSON geometry stored as JSONB
  geometry jsonb NOT NULL,
  -- Additional metadata
  metadata jsonb DEFAULT '{}'::jsonb,
  -- For trails: open/closed status
  status text CHECK (status IN ('open', 'closed', 'groomed', 'ungroomed')) DEFAULT 'open',
  active boolean DEFAULT true,
  order_index integer,
  created_at timestamptz DEFAULT now()
);

-- Indexes for performance
CREATE INDEX idx_ski_features_resort_id ON ski_features(resort_id);
CREATE INDEX idx_ski_features_type ON ski_features(type);
CREATE INDEX idx_ski_features_active ON ski_features(active);

-- RLS Policies for ski features
ALTER TABLE ski_features ENABLE ROW LEVEL SECURITY;

-- Public read access to active features
CREATE POLICY "Active ski features are viewable by everyone"
  ON ski_features FOR SELECT
  USING (active = true);

-- Admins can manage features for their resort
CREATE POLICY "Ski features can be managed by admins or resort admins"
  ON ski_features FOR ALL
  USING (
    auth.role() = 'authenticated' AND (
      EXISTS (
        SELECT 1 FROM user_metadata
        WHERE id = auth.uid() AND is_admin = true
      )
      OR EXISTS (
        SELECT 1 FROM user_metadata
        WHERE id = auth.uid() AND resort_id = ski_features.resort_id
      )
    )
  );

