# New Resort Onboarding Guide

## Overview

**Important:** This application uses a **single codebase and single Supabase instance** for all resorts. You do NOT need to duplicate the project or create new Supabase instances. The system is designed for multi-tenancy with data isolation through Row Level Security (RLS).

## Architecture Summary

- ✅ **Single Next.js application** - One codebase serves all resorts
- ✅ **Single Supabase project** - One database with multi-tenant data isolation
- ✅ **Dynamic routing** - Resorts accessed via `/{resort-slug}/` URLs
- ✅ **Row Level Security** - Database-level isolation per `resort_id`
- ✅ **Whitelabel theming** - Per-resort branding stored in database

## Onboarding Process for New Resorts

### Step 1: Gather Resort Information

Before creating a new resort, collect:

- **Resort Name** (e.g., "Aspen Mountain")
- **Resort Slug** (URL-friendly, e.g., "aspen-mountain")
  - Must be unique
  - Lowercase, hyphens only (no spaces or special characters)
  - Example: `aspen-mountain`, `vail-resort`, `whistler-blackcomb`
- **Subdomain** (optional, for future subdomain routing)
  - Example: `aspen.thehunt.app`
- **Brand Colors** (primary and secondary)
- **Logo URL** (or file to upload to Supabase Storage)
- **Map Center Coordinates** (lat/lng for default map view)
- **Map Zoom Level** (default zoom, typically 12-15)

### Step 2: Create Resort Record in Database

#### Option A: Using Supabase Dashboard (Recommended for First Resort)

1. Go to your Supabase project dashboard
2. Navigate to **Table Editor** → `resorts` table
3. Click **Insert** → **Insert row**
4. Fill in the fields:

```sql
name: "Aspen Mountain"
slug: "aspen-mountain"
subdomain: "aspen" (optional)
theme_config: {
  "primaryColor": "#FF5733",
  "secondaryColor": "#33C3F0",
  "fontFamily": "Inter, sans-serif",
  "logoUrl": "https://your-cdn.com/aspen-logo.png"
}
map_config: {
  "center": [39.1911, -106.8175],
  "zoom": 13
}
```

5. Click **Save**

#### Option B: Using SQL (Recommended for Multiple Resorts)

Run this SQL in Supabase SQL Editor:

```sql
INSERT INTO resorts (name, slug, subdomain, theme_config, map_config)
VALUES (
  'Aspen Mountain',
  'aspen-mountain',
  'aspen',
  '{
    "primaryColor": "#FF5733",
    "secondaryColor": "#33C3F0",
    "fontFamily": "Inter, sans-serif",
    "logoUrl": "https://your-cdn.com/aspen-logo.png"
  }'::jsonb,
  '{
    "center": [39.1911, -106.8175],
    "zoom": 13
  }'::jsonb
);
```

**Note:** The `id` and `created_at` fields are auto-generated.

### Step 3: Create Admin User for Resort

The resort needs at least one admin user to manage signs, settings, and content.

1. **Create Auth User:**
   - Go to Supabase Dashboard → **Authentication** → **Users**
   - Click **Add user** → **Create new user**
   - Enter email and password (or use magic link)
   - Save the user ID (UUID)

2. **Grant Admin Access:**
   - Go to **Table Editor** → `user_metadata` table
   - Insert a row with:
     ```sql
     id: <user-uuid-from-step-1>
     resort_id: <resort-id-from-step-2>
     is_admin: true
     display_name: "Resort Admin Name"
     ```

   Or use SQL:
   ```sql
   INSERT INTO user_metadata (id, resort_id, is_admin, display_name)
   VALUES (
     '<user-uuid>',
     '<resort-id>',
     true,
     'Aspen Mountain Admin'
   );
   ```

### Step 4: Upload Logo to Supabase Storage (Optional)

If you have a logo file:

1. Go to Supabase Dashboard → **Storage**
2. Create a bucket named `resort-assets` (if it doesn't exist)
3. Upload the logo file
4. Get the public URL and update `resorts.theme_config.logoUrl`

Or use the Supabase Storage API:
```typescript
const { data, error } = await supabase.storage
  .from('resort-assets')
  .upload(`resorts/${resortId}/logo.png`, file)
```

### Step 5: Add Signs

Signs can be added via:
- **Admin Panel:** `/{resort-slug}/admin/signs/new`
- **Bulk Import:** CSV import script (see below)
- **SQL:** Direct database insert

#### Via Admin Panel:
1. Log in as the resort admin
2. Navigate to `/{resort-slug}/admin/signs/new`
3. Fill in sign details:
   - Name, description, hint
   - QR code (auto-generated UUID or custom)
   - Coordinates (lat/lng)
   - Difficulty level
   - Photo (optional)

#### Via SQL (Bulk Import):
```sql
INSERT INTO signs (resort_id, name, description, hint, qr_code, lat, lng, difficulty, order_index, active)
VALUES 
  (
    '<resort-id>',
    'Sign 1',
    'Description here',
    'Hint here',
    'unique-qr-code-1',
    39.1911,
    -106.8175,
    'easy',
    1,
    true
  ),
  (
    '<resort-id>',
    'Sign 2',
    'Description here',
    'Hint here',
    'unique-qr-code-2',
    39.1920,
    -106.8180,
    'medium',
    2,
    true
  );
```

### Step 6: Import Ski Features (Optional)

If you have trail/lift/boundary data:

1. Use the import script: `scripts/import-ski-features.ts`
2. Or use the admin panel (if feature exists)
3. Or import via SQL with GeoJSON geometry

### Step 7: Test the Resort

1. **Verify Resort Access:**
   - Visit `http://localhost:3000/{resort-slug}` (dev)
   - Or `https://yourdomain.com/{resort-slug}` (production)
   - Should load with resort-specific theme

2. **Test Admin Panel:**
   - Log in as resort admin
   - Visit `/{resort-slug}/admin`
   - Verify you can see and manage signs

3. **Test User Experience:**
   - Create a test user account
   - Verify map loads with correct center/zoom
   - Test QR code scanning
   - Verify theme colors/logo appear

### Step 8: Configure Domain/Subdomain (Production)

If using subdomain routing (e.g., `aspen.thehunt.app`):

1. **DNS Configuration:**
   - Add CNAME record: `aspen` → `your-vercel-domain.com`
   - Or A record pointing to Vercel IPs

2. **Vercel Configuration:**
   - Add domain in Vercel project settings
   - Configure middleware to detect subdomain and route accordingly

3. **Update Resort Record:**
   - Set `subdomain` field in `resorts` table

## Quick Reference: Required Fields

### Resort Table
- ✅ `name` (required)
- ✅ `slug` (required, unique)
- ⚪ `subdomain` (optional)
- ⚪ `theme_config` (optional, defaults to `{}`)
- ⚪ `map_config` (optional, defaults to `{}`)

### Theme Config JSON
```json
{
  "primaryColor": "#hex-color",
  "secondaryColor": "#hex-color",
  "fontFamily": "Font Name, sans-serif",
  "logoUrl": "https://...",
  "faviconUrl": "https://..." (optional)
}
```

### Map Config JSON
```json
{
  "center": [latitude, longitude],
  "zoom": 13,
  "customTiles": "https://..." (optional)
}
```

## Common Issues & Solutions

### Issue: "Resort not found" error
**Solution:** Verify the `slug` matches exactly (case-sensitive, no trailing slashes)

### Issue: Theme not applying
**Solution:** 
- Check `theme_config` JSON is valid
- Verify CSS variables are being set (check browser DevTools)
- Clear browser cache

### Issue: Admin can't access admin panel
**Solution:**
- Verify `user_metadata.is_admin = true`
- Verify `user_metadata.resort_id` matches the resort
- Check RLS policies allow access

### Issue: Users can see other resort's data
**Solution:**
- Verify RLS policies are enabled on all tables
- Check that queries filter by `resort_id`
- Review RLS policies in `supabase/migrations/002_rls_policies.sql`

## Automation Opportunities

### Future: Super Admin Interface

Consider building a super admin interface at `/admin/resorts` to:
- Create new resorts via UI
- Manage all resorts from one place
- View analytics across all resorts
- Bulk operations

### Future: Onboarding API

Create an API endpoint or Supabase Edge Function for automated onboarding:
- Accept resort details via webhook
- Auto-create resort record
- Auto-create admin user
- Send welcome email with credentials

## Cost Considerations

**Per Resort:**
- ✅ No additional hosting costs (shared infrastructure)
- ✅ No additional Supabase project needed
- ✅ Database storage: ~1-10MB per resort (signs, users, discoveries)
- ✅ File storage: ~10-100MB per resort (logos, photos)

**Scaling:**
- Supabase Free Tier: 50K MAU total (across all resorts)
- Vercel Free Tier: Unlimited deployments
- Upgrade when needed: $25/month (Supabase Pro) + $20/month (Vercel Pro)

## Security Best Practices

1. **RLS Policies:** Always verify RLS is enabled and policies are correct
2. **Admin Access:** Limit `is_admin = true` to trusted users only
3. **Resort Isolation:** Never allow cross-resort data access
4. **API Keys:** Keep Supabase service role key secret (server-side only)
5. **User Data:** Respect privacy - users can only see their own discoveries

## Next Steps After Onboarding

1. **Resort Training:**
   - Schedule onboarding call with resort admin
   - Walk through admin panel features
   - Show how to add/edit signs
   - Explain QR code generation

2. **Content Setup:**
   - Help import initial signs
   - Configure map center/zoom
   - Upload logo and branding assets
   - Set up prizes/rewards

3. **Testing:**
   - Test with real users (beta)
   - Gather feedback
   - Iterate on UX

4. **Launch:**
   - Generate QR codes for physical signs
   - Print and place signs at resort
   - Announce to guests
   - Monitor usage and engagement

---

## Example: Complete Onboarding SQL Script

```sql
-- Step 1: Create Resort
INSERT INTO resorts (name, slug, subdomain, theme_config, map_config)
VALUES (
  'Aspen Mountain',
  'aspen-mountain',
  'aspen',
  '{
    "primaryColor": "#FF5733",
    "secondaryColor": "#33C3F0",
    "fontFamily": "Inter, sans-serif",
    "logoUrl": "https://cdn.example.com/aspen-logo.png"
  }'::jsonb,
  '{
    "center": [39.1911, -106.8175],
    "zoom": 13
  }'::jsonb
)
RETURNING id, slug;

-- Step 2: Note the returned resort_id, then create admin user
-- (First create auth user in Supabase Dashboard, then run:)
INSERT INTO user_metadata (id, resort_id, is_admin, display_name)
VALUES (
  '<auth-user-uuid>',
  '<resort-id-from-step-1>',
  true,
  'Aspen Mountain Admin'
);

-- Step 3: Add initial signs
INSERT INTO signs (resort_id, name, description, hint, qr_code, lat, lng, difficulty, order_index)
VALUES 
  (
    '<resort-id>',
    'Summit Sign',
    'Find this sign at the mountain summit',
    'Look for the highest point',
    gen_random_uuid()::text,
    39.1911,
    -106.8175,
    'easy',
    1
  );
```

---

**Questions?** Review the codebase or check `PLAN.md` for architecture details.

