# Environment Variables Setup

## Quick Setup

1. Copy `.env.example` to `.env.local`:
```bash
cp .env.example .env.local
```

2. Fill in your values in `.env.local` (this file is gitignored for security)

## Getting Your Supabase Credentials

1. Go to your Supabase project dashboard: https://app.supabase.com
2. Navigate to **Settings** → **API**
3. Copy the following:
   - **Project URL** → `NEXT_PUBLIC_SUPABASE_URL`
   - **anon/public key** → `NEXT_PUBLIC_SUPABASE_ANON_KEY`

## Map Configuration

The app uses **Leaflet with OpenStreetMap** tiles, which are completely free and require no API key or credit card.

### Using Default OpenStreetMap (Recommended)
No setup needed! The map works out of the box.

### Using Ski-Specific Maps
If you want to use ski resort trail maps, you can uncomment the OpenSkiMap tile layer in `components/game/MapView.tsx`. This shows ski trails and resort features.

See `docs/MAP_OPTIONS.md` for more details on available map providers and custom GIS data options.

## Example .env.local

```env
NEXT_PUBLIC_SUPABASE_URL=https://abcdefghijklmnop.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFiY2RlZmdoaWprbG1ub3AiLCJyb2xlIjoiYW5vbiIsImlhdCI6MTYzMDAwMDAwMCwiZXhwIjoxOTQ1NTc2MDAwfQ.example
# No map API key needed - uses free OpenStreetMap tiles
```

## Important Notes

- Never commit `.env.local` to git (it's already in .gitignore)
- Restart your dev server after changing environment variables
- Use `NEXT_PUBLIC_` prefix for client-side accessible variables

