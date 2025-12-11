# How to Make a User an Admin

There are two types of admin roles:

1. **Super Admin** - Can manage ALL resorts (set `is_admin = true`)
2. **Resort Admin** - Can manage a specific resort (set `resort_id` to the resort)

## Making a User a Super Admin

Super admins can manage all resorts and all data in the system.

### Step 1: Find the User ID

1. Go to Supabase Dashboard → **Authentication** → **Users**
2. Find the user you want to make an admin
3. Copy their **User UID** (UUID)

### Step 2: Update user_metadata

Run this SQL in the Supabase SQL Editor:

```sql
UPDATE user_metadata
SET is_admin = true
WHERE id = 'YOUR_USER_ID_HERE';
```

Replace `YOUR_USER_ID_HERE` with the user's UUID.

### Example

```sql
UPDATE user_metadata
SET is_admin = true
WHERE id = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
```

## Making a User a Resort Admin

Resort admins can only manage their assigned resort.

### Step 1: Find the User ID and Resort ID

1. **User ID**: Supabase Dashboard → **Authentication** → **Users** → Copy User UID
2. **Resort ID**: Supabase Dashboard → **Table Editor** → `resorts` table → Find your resort → Copy the `id`

### Step 2: Update user_metadata

Run this SQL:

```sql
UPDATE user_metadata
SET resort_id = 'YOUR_RESORT_ID_HERE'
WHERE id = 'YOUR_USER_ID_HERE';
```

Replace both IDs with the actual UUIDs.

### Example

```sql
UPDATE user_metadata
SET resort_id = 'resort-uuid-here'
WHERE id = 'user-uuid-here';
```

## Making a User Both Super Admin AND Resort Admin

You can set both `is_admin = true` and `resort_id`:

```sql
UPDATE user_metadata
SET 
  is_admin = true,
  resort_id = 'YOUR_RESORT_ID_HERE'
WHERE id = 'YOUR_USER_ID_HERE';
```

## Quick SQL for Common Tasks

### Make the first user a super admin

```sql
-- This makes the first user in auth.users a super admin
UPDATE user_metadata
SET is_admin = true
WHERE id = (SELECT id FROM auth.users ORDER BY created_at ASC LIMIT 1);
```

### Check if a user is an admin

```sql
SELECT id, is_admin, resort_id
FROM user_metadata
WHERE id = 'YOUR_USER_ID_HERE';
```

### List all admins

```sql
-- List all super admins
SELECT 
  um.id,
  au.email,
  um.is_admin,
  um.resort_id,
  r.name as resort_name
FROM user_metadata um
JOIN auth.users au ON au.id = um.id
LEFT JOIN resorts r ON r.id = um.resort_id
WHERE um.is_admin = true OR um.resort_id IS NOT NULL;
```

## Removing Admin Status

To remove admin status:

```sql
-- Remove super admin status
UPDATE user_metadata
SET is_admin = false
WHERE id = 'YOUR_USER_ID_HERE';

-- Remove resort admin status
UPDATE user_metadata
SET resort_id = NULL
WHERE id = 'YOUR_USER_ID_HERE';
```

## After Making Changes

After updating admin status:
1. The user may need to log out and log back in
2. Refresh the admin panel page
3. The user should now have access to admin features

