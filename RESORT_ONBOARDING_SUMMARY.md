# Resort Onboarding: Process & Protocol

## Direct Answer to Your Question

**❌ NO, you should NOT duplicate the project or create a new Supabase instance.**

Your application is already architected for **multi-tenancy** with a single codebase and single database. Here's the correct approach:

## ✅ Correct Approach: Single Codebase + Single Supabase

### Architecture
- **One Next.js application** - Serves all resorts
- **One Supabase project** - One database with data isolation
- **Dynamic routing** - Each resort accessed via `/{resort-slug}/`
- **Row Level Security (RLS)** - Database-level isolation per `resort_id`

### Why This Works
1. **Cost Effective:** One hosting bill, shared infrastructure
2. **Easy Maintenance:** One codebase to update, one database to manage
3. **Scalable:** Can handle 10s or 100s of resorts
4. **Secure:** RLS ensures data isolation between resorts

## 🚀 Onboarding Process (Step-by-Step)

### Step 1: Create Resort Record
Add a new row to the `resorts` table in your existing Supabase database:

**Option A: Use the Script (Easiest)**
```bash
npx tsx scripts/create-resort.ts
```

**Option B: Use Supabase Dashboard**
1. Go to Supabase Dashboard → Table Editor → `resorts`
2. Click "Insert row"
3. Fill in:
   - `name`: "New Resort Name"
   - `slug`: "new-resort-slug" (URL-friendly, unique)
   - `theme_config`: JSON with colors, logo, fonts
   - `map_config`: JSON with center coordinates and zoom

**Option C: Use SQL**
```sql
INSERT INTO resorts (name, slug, theme_config, map_config)
VALUES (
  'New Resort',
  'new-resort-slug',
  '{"primaryColor": "#FF5733", "secondaryColor": "#33C3F0"}'::jsonb,
  '{"center": [39.1911, -106.8175], "zoom": 13}'::jsonb
);
```

### Step 2: Create Admin User
1. Create auth user in Supabase Dashboard → Authentication
2. Grant admin access:
   ```sql
   INSERT INTO user_metadata (id, resort_id, is_admin, display_name)
   VALUES ('<user-uuid>', '<resort-id>', true, 'Resort Admin');
   ```

### Step 3: Add Content
- Add signs via admin panel: `/{resort-slug}/admin/signs`
- Configure theme: `/{resort-slug}/admin/settings`
- Import ski features (optional)

### Step 4: Test
Visit `http://localhost:3000/{resort-slug}` to verify it works.

## 📋 What Gets Created

When you add a new resort, you're creating:
- ✅ One row in `resorts` table
- ✅ Theme configuration (stored as JSON)
- ✅ Map configuration (stored as JSON)
- ❌ **NO new codebase**
- ❌ **NO new Supabase project**
- ❌ **NO new deployment**

## 🔒 Data Isolation

Your existing RLS (Row Level Security) policies ensure:
- Each resort's signs are isolated by `resort_id`
- Users can only see their own discoveries
- Admins can only manage their own resort's data
- No cross-resort data leakage

## 💰 Cost Impact

**Per New Resort:**
- Database storage: ~1-10MB (signs, users, discoveries)
- File storage: ~10-100MB (logos, photos)
- **No additional hosting costs**
- **No additional Supabase project needed**

Your existing Supabase free tier (50K MAU) covers all resorts combined.

## 🎯 Real-World Example

Let's say you currently have:
- Resort 1: "Aspen Mountain" (slug: `aspen-mountain`)
- Resort 2: "Your Hometown" (slug: `hometown`)

**To add Resort 3: "Vail Resort"**

1. Run: `npx tsx scripts/create-resort.ts`
2. Enter: Name="Vail Resort", Slug="vail-resort"
3. Done! Now accessible at `/vail-resort`

**That's it!** No code changes, no new deployments, no new Supabase projects.

## 📚 Full Documentation

For detailed instructions, see:
- **[ONBOARDING_GUIDE.md](./ONBOARDING_GUIDE.md)** - Complete step-by-step guide
- **[PLAN.md](./PLAN.md)** - Architecture details

## ❓ Common Questions

### Q: What if I want different features for different resorts?
**A:** Use feature flags in the database or check `resort_id` in your code to conditionally enable features.

### Q: What if a resort wants their own domain?
**A:** Configure DNS to point to your Vercel deployment, then set the `subdomain` field in the `resorts` table. Update middleware to route by subdomain.

### Q: What if I need to scale beyond Supabase free tier?
**A:** Upgrade to Supabase Pro ($25/month) which covers all resorts. Still cheaper than multiple instances.

### Q: Can resorts see each other's data?
**A:** No. RLS policies prevent this. Each query filters by `resort_id` automatically.

## 🎉 Summary

**The Process:**
1. Add one row to `resorts` table
2. Create admin user
3. Add content (signs, theme)
4. Done!

**The Protocol:**
- ✅ Use existing codebase
- ✅ Use existing Supabase instance
- ✅ Isolate data via RLS
- ✅ Scale horizontally (add more resorts = add more rows)

**No duplication needed!** 🚀

