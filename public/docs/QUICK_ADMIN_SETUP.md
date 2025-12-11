# Quick Admin Setup Guide

## Step 1: Run the Migration (Add the is_admin Column)

Go to **Supabase Dashboard → SQL Editor** and run:

```sql
-- Add is_admin field to user_metadata table
ALTER TABLE user_metadata
ADD COLUMN IF NOT EXISTS is_admin boolean DEFAULT false;

-- Create index for admin queries
CREATE INDEX IF NOT EXISTS idx_user_metadata_is_admin ON user_metadata(is_admin);
```

## Step 2: Find Your User ID

1. Go to **Supabase Dashboard → Authentication → Users**
2. Find your user in the list
3. Click on your user
4. Copy the **User UID** (it's a UUID like `a1b2c3d4-e5f6-7890-abcd-ef1234567890`)

**OR** find it in the `user_metadata` table:
1. Go to **Table Editor → user_metadata**
2. Look at the `id` column (this is your user ID)

## Step 3: Update user_metadata Table

You have TWO options:

### Option A: Using SQL Editor (Easiest)

1. Go to **SQL Editor**
2. Run this SQL (replace `YOUR_USER_ID_HERE` with your actual User ID):

```sql
UPDATE user_metadata
SET is_admin = true
WHERE id = 'YOUR_USER_ID_HERE';
```

### Option B: Using Table Editor

1. Go to **Table Editor → user_metadata**
2. Find your row (the `id` should match your User ID)
3. Click on the row to edit
4. Find the `is_admin` column
5. Change it from `false` to `true`
6. Click **Save**

## Quick Copy-Paste SQL (After Migration)

If you want to make yourself admin right now, use this (it will update the first user):

```sql
-- Step 1: Add the column (if not already done)
ALTER TABLE user_metadata
ADD COLUMN IF NOT EXISTS is_admin boolean DEFAULT false;

-- Step 2: Make yourself admin (updates first user in auth.users)
UPDATE user_metadata
SET is_admin = true
WHERE id = (
  SELECT id FROM auth.users 
  ORDER BY created_at ASC 
  LIMIT 1
);
```

## Verify It Worked

Check that you're now an admin:

```sql
SELECT id, is_admin, resort_id
FROM user_metadata
WHERE is_admin = true;
```

This should show your user with `is_admin = true`.

## Important Notes

- ✅ `is_admin` is in the **`user_metadata`** table
- ❌ It's NOT in **Authentication → Users** (that's just for auth)
- ✅ You need to run the migration FIRST to add the column
- ✅ Then update the value via SQL or Table Editor

