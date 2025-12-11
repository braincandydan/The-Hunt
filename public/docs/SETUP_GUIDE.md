# Setup Guide for Resorts

This guide will help you set up The Hunt scavenger hunt app for your ski resort.

## Initial Setup

### 1. Create Your Resort

After logging into the admin panel, you'll need to create your resort entry in the database. Contact support to get your resort set up initially.

### 2. Configure Resort Settings

1. Navigate to **Settings** in the admin panel
2. Customize your theme:
   - **Primary Color**: Your brand's main color
   - **Secondary Color**: Accent color
   - **Font Family**: Choose a font that matches your brand
   - **Logo URL**: Upload your logo to Supabase Storage and paste the URL

3. Click **Save Settings**

### 3. Add Signs

1. Go to **Signs** in the admin panel
2. Click **Add New Sign**
3. Fill in the sign information:
   - **Name**: Display name for the sign
   - **Description**: What users will see about the sign
   - **Hint**: Clue to help users find the sign
   - **QR Code**: Unique identifier (auto-generated, or generate new one)
   - **Latitude/Longitude**: GPS coordinates where the sign is located
   - **Difficulty**: Easy, Medium, or Hard
   - **Order Index**: Order in which signs appear in the list
   - **Active**: Whether the sign is visible to users

4. Click **Create Sign**

### 4. Generate QR Codes for Physical Signs

For each sign:

1. Copy the QR Code value from the sign's details
2. Use a QR code generator (like [QR Code Generator](https://www.qr-code-generator.com/))
3. Generate a QR code with the value
4. Print the QR code on weather-resistant material
5. Attach to your physical sign

## Best Practices

### Sign Placement

- Place signs in visible but interesting locations
- Consider weather exposure - use laminated QR codes
- Test GPS coordinates at the actual sign location
- Use hints that are challenging but not impossible

### QR Code Printing

- Print at least 2" x 2" (5cm x 5cm) for easy scanning
- Use high-contrast colors (black QR code on white background)
- Laminate for weather resistance
- Test scanning with multiple phone cameras

### User Experience

- Keep descriptions engaging and informative
- Make hints progressively more helpful
- Test the full flow before launching
- Consider seasonal placement (some signs may be inaccessible in certain seasons)

## Testing

Before launching to guests:

1. Create a test user account
2. Test scanning each QR code
3. Verify map locations are accurate
4. Test on multiple devices (iOS, Android)
5. Test offline functionality
6. Verify theme customization looks good

## Launch

Once everything is set up:

1. Share the app URL with guests (e.g., `yoursite.com/your-resort-slug`)
2. Promote through:
   - Lift ticket inserts
   - Resort app/website
   - Social media
   - Front desk staff

## Support

For technical support or questions, contact [support email].

