# Creating User Metadata for Existing Users

If you created a user account before running the database trigger migration, you'll need to manually create the `user_metadata` entry.

## Step 1: Find Your User ID

1. Go to your Supabase Dashboard
2. Navigate to **Authentication** → **Users**
3. Find your user in the list
4. Click on the user to view details
5. Copy the **User UID** (it's a UUID like `a1b2c3d4-e5f6-7890-abcd-ef1234567890`)

## Step 2: Create the User Metadata Entry

1. Go to **SQL Editor** in Supabase
2. Run this SQL (replace `YOUR_USER_ID_HERE` with the UUID you copied):

```sql
INSERT INTO public.user_metadata (id)
VALUES ('YOUR_USER_ID_HERE')
ON CONFLICT (id) DO NOTHING;
```

The `ON CONFLICT` clause ensures it won't error if the entry already exists.

## Example

If your user ID is `a1b2c3d4-e5f6-7890-abcd-ef1234567890`, you would run:

```sql
INSERT INTO public.user_metadata (id)
VALUES ('a1b2c3d4-e5f6-7890-abcd-ef1234567890')
ON CONFLICT (id) DO NOTHING;
```

## What You Need

- ✅ **User ID (UUID)** - Found in Authentication → Users
- ❌ **Email** - NOT needed (stored in auth.users)
- ❌ **Password** - NOT needed (stored in auth.users)

## For Multiple Users

If you have multiple existing users, you can create metadata for all of them at once:

```sql
-- This will create user_metadata for all users who don't have it yet
INSERT INTO public.user_metadata (id)
SELECT id FROM auth.users
ON CONFLICT (id) DO NOTHING;
```

This automatically creates `user_metadata` entries for all existing users in your `auth.users` table.

