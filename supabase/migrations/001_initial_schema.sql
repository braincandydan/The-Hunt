-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Resorts table
CREATE TABLE resorts (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  name text NOT NULL,
  slug text UNIQUE NOT NULL,
  subdomain text UNIQUE,
  theme_config jsonb DEFAULT '{}'::jsonb,
  map_config jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now()
);

-- Signs table
CREATE TABLE signs (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  resort_id uuid REFERENCES resorts(id) ON DELETE CASCADE NOT NULL,
  name text NOT NULL,
  description text,
  hint text,
  qr_code text UNIQUE NOT NULL,
  lat numeric(10, 8) NOT NULL,
  lng numeric(11, 8) NOT NULL,
  difficulty text CHECK (difficulty IN ('easy', 'medium', 'hard')),
  photo_url text,
  order_index integer,
  active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- User metadata table (extends auth.users)
CREATE TABLE user_metadata (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  resort_id uuid REFERENCES resorts(id),
  pass_number text,
  display_name text,
  created_at timestamptz DEFAULT now()
);

-- User discoveries table
CREATE TABLE user_discoveries (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  sign_id uuid REFERENCES signs(id) ON DELETE CASCADE NOT NULL,
  discovered_at timestamptz DEFAULT now(),
  gps_lat numeric(10, 8),
  gps_lng numeric(11, 8),
  qr_verified boolean DEFAULT true,
  UNIQUE(user_id, sign_id)
);

-- Prizes table
CREATE TABLE prizes (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  resort_id uuid REFERENCES resorts(id) ON DELETE CASCADE NOT NULL,
  title text NOT NULL,
  description text,
  requirement text,
  active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- Indexes for performance
CREATE INDEX idx_signs_resort_id ON signs(resort_id);
CREATE INDEX idx_signs_active ON signs(active);
CREATE INDEX idx_user_discoveries_user_id ON user_discoveries(user_id);
CREATE INDEX idx_user_discoveries_sign_id ON user_discoveries(sign_id);
CREATE INDEX idx_user_metadata_resort_id ON user_metadata(resort_id);
CREATE INDEX idx_prizes_resort_id ON prizes(resort_id);

