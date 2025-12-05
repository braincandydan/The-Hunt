-- SQL script to add signs 2-14 to your resort
-- Replace 'YOUR_RESORT_ID' with your actual resort UUID
-- You can find your resort ID by running: SELECT id, name, slug FROM resorts;

-- Sign 2: Summit Vista
INSERT INTO signs (resort_id, name, description, hint, qr_code, lat, lng, difficulty, order_index, active)
VALUES (
  'YOUR_RESORT_ID',  -- Replace with your resort_id
  'Sign 2',
  'A sign with a view of the summit',
  'Look for the highest point where you can see the entire valley below. This sign is at the peak where eagles dare to fly!',
  gen_random_uuid()::text,
  49.7485,
  -118.9620,
  'medium',
  2,
  true
);

-- Sign 3: Tree Line Trail
INSERT INTO signs (resort_id, name, description, hint, qr_code, lat, lng, difficulty, order_index, active)
VALUES (
  'YOUR_RESORT_ID',
  'Sign 3',
  'Hidden among the trees',
  'Where the forest meets the slopes, look for a sign nestled between the pines. The trees whisper secrets to those who listen!',
  gen_random_uuid()::text,
  49.7320,
  -118.9450,
  'easy',
  3,
  true
);

-- Sign 4: Lift Line Lookout
INSERT INTO signs (resort_id, name, description, hint, qr_code, lat, lng, difficulty, order_index, active)
VALUES (
  'YOUR_RESORT_ID',
  'Sign 4',
  'Near the chairlift',
  'Find the sign where skiers queue up for their next adventure. It''s right where the lift takes you higher!',
  gen_random_uuid()::text,
  49.7380,
  -118.9280,
  'easy',
  4,
  true
);

-- Sign 5: Powder Bowl
INSERT INTO signs (resort_id, name, description, hint, qr_code, lat, lng, difficulty, order_index, active)
VALUES (
  'YOUR_RESORT_ID',
  'Sign 5',
  'In the powder bowl area',
  'Deep in the powder bowl where fresh tracks are made. Look for the sign where the snow is always deepest!',
  gen_random_uuid()::text,
  49.7420,
  -118.9500,
  'hard',
  5,
  true
);

-- Sign 6: Mid-Mountain Rest
INSERT INTO signs (resort_id, name, description, hint, qr_code, lat, lng, difficulty, order_index, active)
VALUES (
  'YOUR_RESORT_ID',
  'Sign 6',
  'Halfway up the mountain',
  'Perfect spot to catch your breath! This sign marks the midpoint where you''re halfway to the top and halfway to the bottom.',
  gen_random_uuid()::text,
  49.7250,
  -118.9200,
  'medium',
  6,
  true
);

-- Sign 7: Backcountry Gate
INSERT INTO signs (resort_id, name, description, hint, qr_code, lat, lng, difficulty, order_index, active)
VALUES (
  'YOUR_RESORT_ID',
  'Sign 7',
  'At the backcountry access point',
  'Where the groomed trails end and adventure begins. This sign guards the gateway to untracked terrain!',
  gen_random_uuid()::text,
  49.7350,
  -118.9750,
  'hard',
  7,
  true
);

-- Sign 8: Bunny Hill Bonus
INSERT INTO signs (resort_id, name, description, hint, qr_code, lat, lng, difficulty, order_index, active)
VALUES (
  'YOUR_RESORT_ID',
  'Sign 8',
  'On the beginner slope',
  'Even beginners can find this one! Look for the sign where new skiers learn to make their first turns.',
  gen_random_uuid()::text,
  49.7180,
  -118.9350,
  'easy',
  8,
  true
);

-- Sign 9: Ridge Runner
INSERT INTO signs (resort_id, name, description, hint, qr_code, lat, lng, difficulty, order_index, active)
VALUES (
  'YOUR_RESORT_ID',
  'Sign 9',
  'Along the ridge line',
  'Follow the ridge where the wind always blows. This sign is perched on the edge where you can see both sides of the mountain!',
  gen_random_uuid()::text,
  49.7500,
  -118.9680,
  'hard',
  9,
  true
);

-- Sign 10: Glade Guardian
INSERT INTO signs (resort_id, name, description, hint, qr_code, lat, lng, difficulty, order_index, active)
VALUES (
  'YOUR_RESORT_ID',
  'Sign 10',
  'In the gladed area',
  'Hidden in the trees where powder stays fresh longest. Look for the sign among the glades where tree skiing is at its finest!',
  gen_random_uuid()::text,
  49.7290,
  -118.9550,
  'medium',
  10,
  true
);

-- Sign 11: Base Camp
INSERT INTO signs (resort_id, name, description, hint, qr_code, lat, lng, difficulty, order_index, active)
VALUES (
  'YOUR_RESORT_ID',
  'Sign 11',
  'Near the base area',
  'Where your adventure begins! This sign is close to where you first step onto the mountain.',
  gen_random_uuid()::text,
  49.7200,
  -118.9180,
  'easy',
  11,
  true
);

-- Sign 12: Steep & Deep
INSERT INTO signs (resort_id, name, description, hint, qr_code, lat, lng, difficulty, order_index, active)
VALUES (
  'YOUR_RESORT_ID',
  'Sign 12',
  'On the steepest run',
  'For expert skiers only! This sign marks one of the most challenging slopes on the mountain. Are you brave enough?',
  gen_random_uuid()::text,
  49.7440,
  -118.9600,
  'hard',
  12,
  true
);

-- Sign 13: Sunset Slope
INSERT INTO signs (resort_id, name, description, hint, qr_code, lat, lng, difficulty, order_index, active)
VALUES (
  'YOUR_RESORT_ID',
  'Sign 13',
  'Best sunset viewing spot',
  'Where the day ends in golden glory! This sign is at the perfect spot to watch the sun set over the mountains.',
  gen_random_uuid()::text,
  49.7460,
  -118.9520,
  'medium',
  13,
  true
);

-- Sign 14: Hidden Hollow
INSERT INTO signs (resort_id, name, description, hint, qr_code, lat, lng, difficulty, order_index, active)
VALUES (
  'YOUR_RESORT_ID',
  'Sign 14',
  'In a hidden valley',
  'Off the beaten path! This sign is tucked away in a hidden hollow that only the most curious explorers find.',
  gen_random_uuid()::text,
  49.7270,
  -118.9400,
  'medium',
  14,
  true
);

