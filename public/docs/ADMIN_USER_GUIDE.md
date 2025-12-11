# Admin User Guide

Welcome to The Hunt admin panel! This guide will help you manage your scavenger hunt.

## Getting Started

### Logging In

1. Navigate to your resort's admin URL: `yoursite.com/your-resort-slug/admin`
2. Log in with your email and password
3. If you don't have an account, contact your system administrator

## Dashboard

The dashboard provides an overview of:
- **Total Signs:** Number of signs created
- **Discoveries:** Total sign discoveries by all users
- **Users:** Number of registered users

### Quick Actions

- **Add New Sign:** Create a new scavenger hunt sign
- **Customize Theme:** Update branding and appearance
- **Preview Game:** See how guests view the hunt

## Managing Signs

### Creating a Sign

1. Click **Add New Sign** or go to **Signs** → **Add New**
2. Fill in the form:
   - **Name** (required): Display name
   - **Description**: What users see about the sign
   - **Hint**: Clue to help find the sign
   - **QR Code**: Unique identifier (auto-generated)
   - **Latitude/Longitude** (required): GPS coordinates
   - **Difficulty**: Easy, Medium, or Hard
   - **Order Index**: Display order (0, 1, 2, etc.)
   - **Active**: Toggle visibility to users

3. Click **Create Sign**
4. Copy the QR Code value to generate a physical QR code

### Editing a Sign

1. Go to **Signs** page
2. Click **Edit** next to the sign
3. Update fields as needed
4. Save changes

### Deactivating a Sign

1. Edit the sign
2. Uncheck **Active**
3. Save - sign will be hidden from users but data preserved

## Customizing Theme

### Accessing Settings

Navigate to **Settings** in the admin panel

### Theme Options

**Primary Color:**
- Your brand's main color
- Used for buttons, links, highlights
- Enter hex code (e.g., #FF5733) or use color picker

**Secondary Color:**
- Accent color for variety
- Used for secondary elements

**Font Family:**
- Choose web-safe fonts or Google Fonts
- Examples: "Roboto, sans-serif", "Inter, sans-serif"
- Leave default for system fonts

**Logo URL:**
- Full URL to your logo image
- Upload to Supabase Storage or your CDN
- Recommended: PNG with transparent background
- Size: 200-400px wide

### Previewing Changes

After saving, preview your changes by:
1. Clicking **Preview Game** or
2. Opening the game URL in a new tab

Changes take effect immediately.

## User Management

### Viewing Users

Currently, user management is view-only. Contact support for:
- User statistics
- Completion rates
- User data exports

## Analytics

### Viewing Stats

Dashboard shows:
- Total signs
- Total discoveries
- Total users

### Detailed Analytics

Contact support for detailed analytics including:
- Sign completion rates
- Most/least found signs
- User engagement metrics
- Time-to-completion statistics

## Best Practices

### Sign Management

- **Test GPS coordinates** at actual sign locations
- **Generate QR codes** after creating signs (don't reuse codes)
- **Use descriptive names** that are memorable
- **Write engaging hints** that balance challenge and help
- **Order signs logically** (easier to harder, or by trail area)

### Theme Customization

- **Test colors** on mobile devices (colors look different on screens)
- **Use high-contrast** for accessibility
- **Keep logo size reasonable** (large logos slow loading)
- **Test font readability** at various sizes

### User Experience

- **Launch with a small set** of signs first, then expand
- **Test the full flow** yourself before launching
- **Get feedback** from a few test users
- **Monitor completion rates** and adjust difficulty

## Troubleshooting

### Sign Issues

**QR code not scanning:**
- Verify QR code value matches database
- Check QR code is printed clearly
- Ensure adequate lighting
- Test with multiple phone cameras

**GPS validation failing:**
- Verify coordinates are accurate (6+ decimal places)
- Check coordinates are in correct order (lat, lng)
- Test at actual sign location

### Theme Issues

**Colors not updating:**
- Clear browser cache
- Hard refresh (Ctrl+F5 / Cmd+Shift+R)
- Verify settings saved successfully

**Logo not showing:**
- Verify URL is accessible (test in browser)
- Check URL is HTTPS (required for secure sites)
- Ensure image format is supported (PNG, JPG, SVG)

## Getting Help

For support:
- Email: [support email]
- Documentation: [docs URL]
- Check error messages for specific issues

## Next Steps

After setup:
1. Create your first few signs
2. Customize your theme
3. Generate and install QR codes
4. Test the full experience
5. Launch to guests!

