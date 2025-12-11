# Fixing RLS Error When Importing

If you get this error:
```
new row violates row-level security policy for table "ski_features"
```

This means the script is using the **anon key** which has RLS restrictions. You need to use the **service role key** instead.

## Solution: Use Service Role Key

The service role key bypasses RLS and is perfect for admin/import scripts.

### Step 1: Get Your Service Role Key

1. Go to your Supabase Dashboard: https://app.supabase.com
2. Select your project
3. Go to **Settings** → **API**
4. Scroll down to find **Project API keys**
5. Copy the **`service_role`** key (NOT the `anon` key)
   - ⚠️ **WARNING**: This key has admin privileges - keep it secret!

### Step 2: Add to .env.local

Add this line to your `.env.local` file:

```env
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here
```

Replace `your_service_role_key_here` with the key you copied.

### Step 3: Run Import Again

```bash
npx tsx scripts/import-ski-features.ts "your-resort-uuid" docs/ski-area.json boundary
```

It should work now! ✅

## Alternative: Temporarily Allow Inserts (Less Secure)

If you can't use the service role key, you can temporarily update RLS:

```sql
-- Temporarily allow anonymous inserts (NOT recommended for production)
CREATE POLICY "Temporary allow anonymous inserts"
  ON ski_features FOR INSERT
  WITH CHECK (true);

-- After importing, remove this policy:
-- DROP POLICY "Temporary allow anonymous inserts" ON ski_features;
```

But using the service role key is the recommended approach.

## Why Service Role Key?

- ✅ Bypasses RLS (no permission errors)
- ✅ Required for admin scripts and migrations
- ✅ More secure than disabling RLS policies
- ✅ Standard practice for backend operations

**Important**: Never commit your `.env.local` file or expose the service role key publicly!

