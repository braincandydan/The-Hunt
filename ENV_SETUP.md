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

## Getting Your Mapbox Token

1. Create a free account at: https://account.mapbox.com/
2. Go to **Access Tokens**
3. Copy your default public token → `NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN`
   - The free tier includes 50,000 map loads per month

## Example .env.local

```env
NEXT_PUBLIC_SUPABASE_URL=https://abcdefghijklmnop.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFiY2RlZmdoaWprbG1ub3AiLCJyb2xlIjoiYW5vbiIsImlhdCI6MTYzMDAwMDAwMCwiZXhwIjoxOTQ1NTc2MDAwfQ.example
NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN=pk.eyJ1IjoieW91cnVzZXJuYW1lIiwiYSI6ImNrcGV4YW1wbDAwMGIyd3BiaXh4ZnM1d3cifQ.example
```

## Important Notes

- Never commit `.env.local` to git (it's already in .gitignore)
- Restart your dev server after changing environment variables
- Use `NEXT_PUBLIC_` prefix for client-side accessible variables

