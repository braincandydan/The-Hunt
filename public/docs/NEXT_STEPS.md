# Next Steps - Testing & Setup Guide

Great! Your app is working. Here's what to do next to test and set up your first resort.

## 1. Add a Test Resort (if not already done)

You need at least one resort in your database. You can add it via Supabase:

1. Go to your Supabase dashboard → Table Editor → `resorts` table
2. Click "Insert row"
3. Fill in:
   - `name`: "Test Resort" (or any name)
   - `slug`: "test-resort" (this must match the URL: `/test-resort/game`)
   - `description`: (optional)
   - `theme_config`: (optional JSON, can leave null for now)
4. Click "Save"

## 2. Test Admin Panel - Add Signs

1. Make sure you're logged in as an admin (check `user_metadata.is_admin = true`)
2. Go to: `http://localhost:3000/test-resort/admin/signs`
3. Click "New Sign"
4. Fill out the form:
   - **Name**: "Sign #1"
   - **Description**: "First test sign"
   - **Hint**: "Near the lodge entrance"
   - **QR Code**: Auto-generated (you'll use this to scan)
   - **Latitude/Longitude**: Optional (for map view)
     - Example: `40.7128` / `-74.0060` (NYC coordinates)
   - **Difficulty**: Choose a level
   - **Order Index**: `0` (order in list)
   - **Active**: Checked
5. Click "Create Sign"
6. Repeat to add 2-3 more signs for testing

## 3. Test Game Experience

1. Go to: `http://localhost:3000/test-resort/game`
2. You should see:
   - Resort name
   - Progress bar (0/X signs found)
   - List of signs you created
3. Click on a sign to view details
4. On the sign detail page, you'll see the QR scanner

## 4. Test QR Code Scanning

**Option A: Generate a QR Code**
1. Go to sign detail page in admin: `http://localhost:3000/test-resort/admin/signs/[sign-id]/edit`
2. Copy the QR Code value (UUID)
3. Generate a QR code online (e.g., https://www.qr-code-generator.com/)
4. Enter the UUID as the content
5. Download/display the QR code on another device or screen

**Option B: Use QR Code from Admin Panel**
- The QR code value is shown in the sign edit page
- Scan it with the scanner component

**To Scan:**
1. Click on a sign from the game page
2. Click "Scan QR Code" button
3. Allow camera permissions
4. Point camera at the QR code
5. If the code matches, you'll get a success message and the sign will be marked as found!

## 5. Test Map View

1. Make sure your signs have `lat` and `lng` values
2. Go to: `http://localhost:3000/test-resort/game/map`
3. You should see a map with markers for each sign
4. Green markers = signs you've found
5. Gray markers = signs not yet found

**Note:** The app uses OpenStreetMap tiles which are completely free and require no API key or credit card. You can also customize the map tiles:
- **Default:** OpenStreetMap (free, standard map)
- **Ski Maps:** OpenSkiMap (free, shows ski trails - see code comments in `MapView.tsx`)
- **Custom:** You can load your own GIS data or use other tile providers

## 6. Customize Theme

1. Go to: `http://localhost:3000/test-resort/admin/settings`
2. Customize:
   - Primary Color (e.g., `#FF5733`)
   - Secondary Color (e.g., `#33C3F0`)
   - Font Family (e.g., `'Roboto', sans-serif`)
   - Logo URL (optional)
3. Click "Save Settings"
4. Refresh the game page to see the theme applied

## 7. Test as Regular User

1. Create a second user account (or use a different browser/incognito)
2. Log in as that user
3. Go to the game page - you should see all signs as "Not found"
4. Try scanning QR codes to mark signs as found
5. Watch the progress bar update!

## 8. What to Test

- ✅ Can you see the admin dashboard?
- ✅ Can you create/edit/delete signs?
- ✅ Does the game page show your signs?
- ✅ Can you click on a sign to see details?
- ✅ Does QR scanning work?
- ✅ Do signs mark as "found" after scanning?
- ✅ Does the progress bar update?
- ✅ Does the map show sign locations?
- ✅ Do found signs show as green on the map?
- ✅ Does theme customization work?
- ✅ Can non-admin users access the game but not admin?

## Troubleshooting

**QR Scanner not working?**
- Make sure camera permissions are granted
- Try on a mobile device or use HTTPS (QR scanner needs secure context)

**Map not showing?**
- Make sure signs have valid lat/lng coordinates
- Check browser console for errors (Leaflet CSS should load automatically)
- Ensure you're using HTTPS in production (some tile servers require it)

**Signs not appearing?**
- Check that `active = true` in the database
- Verify `resort_id` matches your resort's ID

**Theme not applying?**
- Check browser console for errors
- Verify JSON in `theme_config` is valid
- Try hard refresh (Ctrl+Shift+R)

## Next Features to Build

Once testing is complete, consider:

1. **Prize System**: Configure rewards for completing all signs
2. **User Profile Page**: Show user's stats and achievements
3. **Bulk Sign Import**: CSV upload for admins
4. **QR Code Generation**: Auto-generate/download QR codes in admin
5. **Analytics Dashboard**: Completion rates, popular signs, etc.
6. **Email Notifications**: Send completion certificates
7. **Social Sharing**: Share completion badges

## Need Help?

Check the other docs:
- `ADMIN_USER_GUIDE.md` - Full admin documentation
- `QR_CODE_GUIDELINES.md` - QR code best practices
- `SETUP_GUIDE.md` - Initial setup instructions

