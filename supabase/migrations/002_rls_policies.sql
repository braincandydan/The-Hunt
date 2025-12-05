-- Enable Row Level Security
ALTER TABLE resorts ENABLE ROW LEVEL SECURITY;
ALTER TABLE signs ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_metadata ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_discoveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE prizes ENABLE ROW LEVEL SECURITY;

-- Resorts: Public read access, admins can manage their own resort
CREATE POLICY "Resorts are viewable by everyone"
  ON resorts FOR SELECT
  USING (true);

CREATE POLICY "Resorts can be managed by authenticated users"
  ON resorts FOR ALL
  USING (auth.role() = 'authenticated');

-- Signs: Public read access to active signs, resort admins can manage
CREATE POLICY "Active signs are viewable by everyone"
  ON signs FOR SELECT
  USING (active = true);

CREATE POLICY "Signs can be managed by authenticated users"
  ON signs FOR ALL
  USING (auth.role() = 'authenticated');

-- User metadata: Users can see and update their own metadata
CREATE POLICY "Users can view their own metadata"
  ON user_metadata FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Users can update their own metadata"
  ON user_metadata FOR UPDATE
  USING (auth.uid() = id);

CREATE POLICY "Users can insert their own metadata"
  ON user_metadata FOR INSERT
  WITH CHECK (auth.uid() = id);

-- User discoveries: Users can only see their own discoveries
CREATE POLICY "Users can view their own discoveries"
  ON user_discoveries FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own discoveries"
  ON user_discoveries FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Prizes: Public read access, admins can manage
CREATE POLICY "Prizes are viewable by everyone"
  ON prizes FOR SELECT
  USING (active = true);

CREATE POLICY "Prizes can be managed by authenticated users"
  ON prizes FOR ALL
  USING (auth.role() = 'authenticated');

