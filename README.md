# The Hunt - Ski Resort Scavenger Hunt App

A whitelabel scavenger hunt application for ski resorts built with Next.js 14 and Supabase.

## Features

- 🔍 QR Code scanning for sign verification
- 🗺️ Interactive map view with sign locations
- 🎨 Whitelabel theming per resort
- 👥 Multi-tenant architecture
- 📱 Progressive Web App (PWA) support
- 🔐 Supabase authentication
- 🛡️ Row Level Security (RLS) for data isolation
- ⚙️ Admin panel for resort management

## Tech Stack

- **Frontend:** Next.js 14 (App Router), React, TypeScript
- **Backend:** Supabase (PostgreSQL, Auth, Storage)
- **Styling:** TailwindCSS
- **Maps:** Leaflet with OpenStreetMap (free, no API key required)
- **QR Scanning:** @zxing/library
- **PWA:** next-pwa

## Getting Started

### Prerequisites

- Node.js 18+ and npm
- Supabase account
- No map API key needed (uses free OpenStreetMap)

### Installation

1. Clone the repository
2. Install dependencies:
```bash
npm install
```

3. Set up environment variables:
Create a `.env.local` file with:
```
NEXT_PUBLIC_SUPABASE_URL=your_supabase_project_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key  # For admin scripts only
# No map API key needed - uses free OpenStreetMap tiles
```

4. Set up Supabase database:
   - Run the migrations in `supabase/migrations/` on your Supabase project
   - Enable Row Level Security on all tables
   - Configure authentication settings

5. Run the development server:
```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Project Structure

```
├── app/                    # Next.js App Router pages
│   ├── [resort-slug]/     # Dynamic resort routes
│   │   ├── game/          # User-facing game pages
│   │   └── admin/         # Admin panel
│   ├── login/             # Authentication
│   └── layout.tsx         # Root layout
├── components/            # React components
│   ├── game/             # Game-specific components
│   └── admin/            # Admin components
├── lib/                   # Utility libraries
│   ├── supabase/         # Supabase client setup
│   ├── themes/           # Whitelabel theme system
│   └── utils/            # Helper functions
├── supabase/             # Database migrations
│   └── migrations/       # SQL migration files
└── public/               # Static assets
```

## Database Schema

The application uses the following main tables:
- `resorts` - Resort information and theme config
- `signs` - Scavenger hunt signs
- `user_discoveries` - User sign discoveries
- `user_metadata` - Extended user information
- `prizes` - Prizes/rewards configuration

See `supabase/migrations/` for the complete schema.

## Adding New Resorts

This application supports multiple resorts in a single deployment. To onboard a new resort:

1. **Quick Start:** Use the automated script:
   ```bash
   npx tsx scripts/create-resort.ts
   ```

2. **Manual Setup:** See [ONBOARDING_GUIDE.md](./ONBOARDING_GUIDE.md) for detailed instructions.

**Key Points:**
- ✅ Single codebase serves all resorts
- ✅ Single Supabase instance (no duplication needed)
- ✅ Data isolation via Row Level Security (RLS)
- ✅ Per-resort theming and branding

## Deployment

### Vercel (Recommended)

1. Push your code to GitHub
2. Import project in Vercel
3. Add environment variables
4. Deploy

### Supabase Setup

1. Create a new Supabase project
2. Run migrations from `supabase/migrations/`
3. Enable Storage for logo/image uploads
4. Configure authentication settings

## License

ISC

