# How the Create Resort Script Works

## Two Ways to Use It

### Mode 1: Interactive (Asks You Questions) ✨ **Recommended for First Time**

When you run:
```bash
npx tsx scripts/create-resort.ts
```

The script will **prompt you** for each piece of information:

```
🏔️  Resort Creation Script
========================

Enter resort details (press Enter to use defaults):

Resort Name: Aspen Mountain
Resort Slug (URL-friendly, e.g., "aspen-mountain"): aspen-mountain
Subdomain (optional, e.g., "aspen"): aspen
Primary Color (default: #6366f1): #FF5733
Secondary Color (default: #8b5cf6): #33C3F0
Font Family (default: Inter, sans-serif): Inter, sans-serif
Logo URL (optional): https://example.com/logo.png
Map Center Latitude (optional): 39.1911
Map Center Longitude (optional): -106.8175
Map Zoom Level (optional, default: 13): 13
```

**How it works:**
1. Uses Node.js `readline` to read from your terminal
2. Asks each question one at a time
3. You type your answer and press Enter
4. If you press Enter without typing, it uses the default value (shown in parentheses)
5. Required fields (name, slug) must be filled in

### Mode 2: Non-Interactive (Uses Environment Variables)

When you set environment variables first:
```bash
RESORT_NAME="Aspen Mountain" \
RESORT_SLUG="aspen-mountain" \
PRIMARY_COLOR="#FF5733" \
npx tsx scripts/create-resort.ts
```

**How it works:**
1. Script checks if `RESORT_NAME` and `RESORT_SLUG` are set
2. If they are, it skips the interactive prompts
3. Uses the environment variables instead
4. Useful for automation or scripts

## What Happens Behind the Scenes

### Step 1: Connect to Supabase
```typescript
// Reads from .env.local
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

// Creates Supabase client with admin privileges
const supabase = createClient(supabaseUrl, supabaseServiceKey)
```

### Step 2: Check for Duplicates
```typescript
// Before creating, checks if slug already exists
const { data: existing } = await supabase
  .from('resorts')
  .select('id, name')
  .eq('slug', input.slug)
  .maybeSingle()

if (existing) {
  // Stops and shows error
  console.error('Resort with slug already exists!')
}
```

### Step 3: Build JSON Configs
```typescript
// Converts your input into JSON for database
const themeConfig = {
  primaryColor: "#FF5733",
  secondaryColor: "#33C3F0",
  fontFamily: "Inter, sans-serif",
  logoUrl: "https://..."
}

const mapConfig = {
  center: [39.1911, -106.8175],
  zoom: 13
}
```

### Step 4: Insert into Database
```typescript
// Creates the resort record
const { data: resort } = await supabase
  .from('resorts')
  .insert({
    name: "Aspen Mountain",
    slug: "aspen-mountain",
    theme_config: themeConfig,
    map_config: mapConfig
  })
```

### Step 5: Show Results
Shows you:
- ✅ Success message
- 📊 Resort ID, name, slug
- 🔗 URLs to access the resort
- 📝 Next steps (create admin user, etc.)

## Required vs Optional Fields

### Required (Must Provide):
- ✅ **Resort Name** - Display name (e.g., "Aspen Mountain")
- ✅ **Resort Slug** - URL-friendly identifier (e.g., "aspen-mountain")

### Optional (Has Defaults or Can Skip):
- ⚪ **Subdomain** - For future subdomain routing
- ⚪ **Primary Color** - Defaults to `#6366f1` (indigo)
- ⚪ **Secondary Color** - Defaults to `#8b5cf6` (purple)
- ⚪ **Font Family** - Defaults to `Inter, sans-serif`
- ⚪ **Logo URL** - Can add later
- ⚪ **Map Center** - Can configure later in admin panel
- ⚪ **Map Zoom** - Defaults to `13`

## Example: Full Interactive Session

```bash
$ npx tsx scripts/create-resort.ts

🏔️  Resort Creation Script
========================

Enter resort details (press Enter to use defaults):

Resort Name: Vail Resort
Resort Slug (URL-friendly, e.g., "aspen-mountain"): vail-resort
Subdomain (optional, e.g., "aspen"): [Press Enter - skipped]
Primary Color (default: #6366f1): #1E40AF
Secondary Color (default: #8b5cf6): [Press Enter - uses default]
Font Family (default: Inter, sans-serif): [Press Enter - uses default]
Logo URL (optional): [Press Enter - skipped]
Map Center Latitude (optional): 39.6403
Map Center Longitude (optional): -106.3742
Map Zoom Level (optional, default: 13): [Press Enter - uses default]

📋 Creating resort with the following details:
   Name: Vail Resort
   Slug: vail-resort
   Primary Color: #1E40AF
   Secondary Color: #8b5cf6
   Font: Inter, sans-serif
   Map Center: [39.6403, -106.3742]
   Map Zoom: 13

✅ Resort created successfully!

📊 Resort Details:
   ID: 550e8400-e29b-41d4-a716-446655440000
   Name: Vail Resort
   Slug: vail-resort
   URL: http://localhost:3000/vail-resort
   Admin URL: http://localhost:3000/vail-resort/admin

📝 Next Steps:
   1. Create an admin user in Supabase Dashboard → Authentication → Users
   2. Grant admin access by running:
      INSERT INTO user_metadata (id, resort_id, is_admin, display_name)
      VALUES ('<user-uuid>', '550e8400-e29b-41d4-a716-446655440000', true, 'Vail Resort Admin');
   3. Log in and add signs via the admin panel
   4. Configure theme and branding at /vail-resort/admin/settings
```

## Troubleshooting

### "Missing required environment variables"
**Problem:** Script can't find Supabase credentials  
**Solution:** Make sure `.env.local` has:
```
NEXT_PUBLIC_SUPABASE_URL=your_url
SUPABASE_SERVICE_ROLE_KEY=your_key
```

### "Resort with slug already exists"
**Problem:** You're trying to use a slug that's already taken  
**Solution:** Choose a different slug (e.g., `vail-resort-2` or `vail-mountain`)

### Script hangs or doesn't respond
**Problem:** Terminal input issue  
**Solution:** 
- Make sure you're in an interactive terminal (not a script)
- Try typing something and pressing Enter
- Press Ctrl+C to cancel and try again

## Pro Tips

1. **Start Simple:** Just provide name and slug, configure the rest later via admin panel
2. **Use Defaults:** Press Enter for optional fields to use sensible defaults
3. **Test First:** Create a test resort with a unique slug to verify it works
4. **Slug Format:** Use lowercase, hyphens only (e.g., `aspen-mountain`, not `Aspen Mountain` or `aspen_mountain`)

## What Gets Created

The script creates **one database row** in the `resorts` table with:
- Unique ID (auto-generated UUID)
- Name and slug
- Theme configuration (JSON)
- Map configuration (JSON)
- Timestamp (auto-generated)

**That's it!** No code changes, no deployments needed. The resort is immediately accessible at `/{slug}`.

