# Ski Resort Scavenger Hunt App - Next.js + Supabase Implementation Plan

## 1. Technical Architecture - Next.js + Supabase Stack

### Selected Stack: Next.js + Supabase (PWA)
**Technology Stack:**
- **Frontend:** Next.js 14+ (App Router) with React & TypeScript
- **Backend/DB/Auth:** Supabase (PostgreSQL + Auth + Storage + Realtime + Edge Functions)
- **Styling:** TailwindCSS + CSS Variables (for whitelabel theming)
- **Maps:** Mapbox GL JS
- **Hosting:** Vercel (frontend) + Supabase Cloud (backend)
- **QR Scanning:** @zxing/library or react-qr-reader
- **PWA:** next-pwa plugin for offline support

### Why This Stack:
**Whitelabel Ease (9/10):**
- CSS variables for runtime theme switching per resort
- Dynamic logo/image loading from Supabase Storage
- Theme config stored in database per resort
- Subdomain-based multi-tenancy (e.g., `{resort}.thehunt.app`)

**Cost-Effectiveness:**
- Next.js: Free (MIT license)
- Supabase: Free tier (50K MAU, then $25/month per project)
- Vercel: Free tier (hobby), then $20/month (pro)
- Mapbox: Free tier (50K map loads/month)
- **Total MVP:** $0-50/month for multiple resorts

**Proven & Reliable:**
- Next.js: Used by Netflix, TikTok, Hulu (production-tested)
- Supabase: PostgreSQL-based (decades-proven database)
- Active development & security updates
- Large community support

**Resort Sellability:**
- "Powered by Vercel & PostgreSQL" - enterprise-grade infrastructure
- Fast performance scores (Core Web Vitals)
- Serverless auto-scaling (handles traffic spikes)
- SOC 2 compliant (Supabase)

### Architecture Pattern:
- **Multi-tenant:** Single codebase, database row-level security (RLS) per `resort_id`
- **Whitelabel:** CSS variables + dynamic asset loading per subdomain
- **Deployment:** Monorepo or single app with tenant routing

---

## 2. Project Structure

```
the-hunt-app/
├── app/                          # Next.js App Router
│   ├── [resort-slug]/           # Dynamic resort routes
│   │   ├── layout.tsx           # Resort-specific layout (theme)
│   │   ├── game/                # User-facing game pages
│   │   │   ├── page.tsx         # Main game/dashboard
│   │   │   ├── map/page.tsx     # Interactive map
│   │   │   └── sign/[id]/page.tsx  # Individual sign details
│   │   └── admin/               # Admin panel (protected)
│   ├── api/                     # Next.js API routes (if needed)
│   └── layout.tsx               # Root layout
├── components/
│   ├── game/                    # Game-specific components
│   ├── admin/                   # Admin components
│   └── ui/                      # Shared UI components
├── lib/
│   ├── supabase/               # Supabase client & utilities
│   ├── themes/                 # Whitelabel theme system
│   └── utils/                  # Helper functions
├── supabase/
│   ├── migrations/             # Database migrations
│   ├── functions/              # Edge Functions (if needed)
│   └── seed.sql                # Seed data
└── public/                     # Static assets
```

---

## 3. Database Schema (Supabase/PostgreSQL)

### Core Tables:
```sql
-- Resorts table
resorts (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  name text NOT NULL,
  slug text UNIQUE NOT NULL,
  subdomain text UNIQUE,
  theme_config jsonb, -- {primaryColor, fontFamily, logoUrl, etc}
  map_config jsonb, -- Map center, zoom, custom tiles
  created_at timestamptz DEFAULT now()
);

-- Signs table
signs (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  resort_id uuid REFERENCES resorts(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  hint text,
  qr_code text UNIQUE NOT NULL, -- Unique identifier for QR scanning
  lat numeric(10, 8) NOT NULL,
  lng numeric(11, 8) NOT NULL,
  difficulty text, -- easy, medium, hard
  photo_url text, -- Supabase Storage URL
  order_index integer,
  active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- User discoveries (join table)
user_discoveries (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  sign_id uuid REFERENCES signs(id) ON DELETE CASCADE,
  discovered_at timestamptz DEFAULT now(),
  gps_lat numeric(10, 8),
  gps_lng numeric(11, 8),
  qr_verified boolean DEFAULT true,
  UNIQUE(user_id, sign_id)
);

-- User metadata (extends Supabase auth.users)
user_metadata (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  resort_id uuid REFERENCES resorts(id),
  pass_number text,
  display_name text,
  created_at timestamptz DEFAULT now()
);

-- Prizes/rewards
prizes (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  resort_id uuid REFERENCES resorts(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  requirement text, -- e.g., "all_signs", "5_signs"
  active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);
```

### Row Level Security (RLS) Policies:
- Users can only see their own discoveries
- Resort admins can manage only their resort's data
- Public read access to active signs for game

---

## 4. Verification Methods for Sign Discovery

### Primary: QR Code Scanning
- Each physical sign has unique QR code with `signs.qr_code` value
- User scans QR code with phone camera
- App validates code against Supabase database
- Timestamp and GPS location (optional validation) recorded

### Secondary: GPS Validation
- Optional check: User must be within 50-100m radius of sign location
- Uses Web Geolocation API
- Helps prevent spoofing but not foolproof

### Hybrid Approach (Recommended):
- Primary: QR code scanning (reliable, simple)
- Backup: GPS validation (within 50m radius when scanning)
- Optional: Photo capture for resort admin review

---

## 5. Whitelabel System Implementation

### Theme Storage:
- JSON in `resorts.theme_config` column:
```json
{
  "primaryColor": "#FF5733",
  "secondaryColor": "#33C3F0",
  "fontFamily": "Inter, sans-serif",
  "logoUrl": "https://...",
  "faviconUrl": "https://..."
}
```

### CSS Variables Injection:
```typescript
// lib/themes/applyTheme.ts
export function applyTheme(theme: ThemeConfig) {
  document.documentElement.style.setProperty('--color-primary', theme.primaryColor);
  document.documentElement.style.setProperty('--font-family', theme.fontFamily);
  // etc...
}
```

### Dynamic Asset Loading:
- Logos/photos in Supabase Storage (public buckets)
- Per-resort asset organization: `resorts/{resort_id}/logo.png`

### Subdomain Routing:
- Next.js middleware detects subdomain
- Loads resort config based on subdomain
- Applies theme before page render

---

## 6. Core Features Implementation

### User Features:
- **Authentication:** Supabase Auth (email/password, magic links)
- **Account Page:** Profile, progress tracking, completion status
- **Game Dashboard:** List of signs with found/unfound status
- **Map View:** Mapbox map with markers (found = green, unfound = gray)
- **Sign Details:** Individual sign page with hint, description
- **QR Scanner:** Camera access, QR code scanning, validation
- **Progress Tracking:** Visual progress bar, completion percentage

### Admin Features:
- **Resort Settings:** Branding, theme customization
- **Sign Management:** CRUD operations, bulk import (CSV)
- **Map Editor:** Drag-drop pin placement, coordinate setting
- **QR Code Generation:** Per-sign QR codes (downloadable)
- **User Management:** View participants, completion stats
- **Analytics:** Completion rates, engagement metrics
- **Prize Configuration:** Set rewards, requirements

---

## 7. Integration Options with Resort Systems

### Optional Integrations:
1. **Lift Ticket/Pass Integration:**
   - Supabase Edge Function webhook endpoint
   - Resort POS system sends pass data
   - Auto-create users or validate pass numbers

2. **Loyalty/Rewards Programs:**
   - Export completion data via API
   - CSV export for resort CRM import
   - Webhook notifications on completion

3. **Email Marketing:**
   - Supabase Edge Functions + Resend/SendGrid
   - Auto-send completion certificates
   - Reminder emails

4. **Social Media:**
   - Share completion badges
   - Leaderboard (optional, privacy-conscious)

### Implementation Approach:
- RESTful API endpoints (Next.js API routes or Supabase Edge Functions)
- Webhook support for real-time integration
- Standard JSON formats
- Documentation for resort IT teams

---

## 8. Implementation Roadmap

### Week 1-2: Foundation & Setup
- Next.js 14 project setup (App Router, TypeScript)
- Supabase project creation (database + auth + storage)
- Database schema design (migrations for resorts, signs, discoveries)
- Supabase client setup (server/client components)
- TailwindCSS + CSS variables (theme system foundation)
- Basic authentication (Supabase Auth integration)

### Week 3-4: Core User Features
- QR code scanning (@zxing/library or react-qr-reader)
- GPS validation (Web Geolocation API + validation logic)
- Mapbox integration (map display with sign markers)
- Sign discovery flow (scan → validate → record discovery)
- User account page (profile, progress tracking)
- Progress tracking UI (found/unfound indicators)

### Week 5-6: Admin Panel
- Admin authentication (role-based access via Supabase RLS)
- Resort management (CRUD for resort settings)
- Sign CRUD operations (create/edit/delete signs)
- Map editor (drag-drop pin placement, coordinate setting)
- Branding customization (theme editor: colors, fonts, logo upload)
- QR code generation (per-sign QR codes)

### Week 7-8: Multi-Tenancy & Whitelabel
- Subdomain routing (Next.js middleware for tenant detection)
- Theme system implementation (CSS variables + dynamic loading)
- Row Level Security (RLS) policies (Supabase policies for tenant isolation)
- Asset management (Supabase Storage for logos/photos)
- Resort-specific routing (`[resort-slug]` dynamic routes)

### Week 9-10: Polish & PWA
- PWA setup (next-pwa, service workers, offline support)
- Mobile optimization (responsive design, touch interactions)
- Offline mode (cache map data, hints, user progress)
- Performance optimization (image optimization, code splitting)
- Testing (cross-device, cross-browser testing)

### Week 11-12: Deployment & Documentation
- Vercel deployment (production frontend)
- Supabase production setup (backup, monitoring)
- Environment configuration (env vars, secrets)
- Admin documentation (user guides, video tutorials)
- Marketing materials (resort-facing materials, guest flyers)
- Analytics setup (optional: Vercel Analytics, Supabase Analytics)

---

## 9. Cost Breakdown

### Development Costs:
- **Phase 1 (MVP):** $15-25K (8-12 weeks)
- **Phase 2 (Multi-Resort):** $8-12K (4-6 weeks)
- **Phase 3 (Advanced Features):** $5-15K (as needed)

### Monthly Hosting Costs:
- **Supabase:** Free tier (50K MAU) → $25/month (Pro) when needed
- **Vercel:** Free tier → $20/month (Pro) for production
- **Mapbox:** Free tier (50K loads/month) → $5-50/month based on usage
- **Domain:** $10-15/year per custom domain (optional)
- **Email service:** $0 (Resend free tier) or $20/month (SendGrid)
- **Total for 10-50 resorts:** $25-95/month (shared infrastructure)

### Pricing Model for Resorts:
- **One-time setup fee:** $500-1,500 (covers configuration, sign setup)
- **Monthly subscription:** $50-100/month (includes hosting + basic support)
- **OR annual:** $500-1,000/year (2 months free)
- **Optional add-ons:** Custom integrations ($500-2,000), premium support ($50/month)

---

## 10. Next.js + Supabase Specific Considerations

### Technical Advantages:
- **Built-in Auth:** Supabase Auth handles password resets, email verification
- **Automatic Scaling:** Vercel + Supabase scale automatically
- **Row Level Security:** Database-level tenant isolation (security built-in)
- **Edge Functions:** Serverless functions for complex logic (QR validation, emails)
- **Real-time (Optional):** Supabase Realtime for live leaderboards

### Potential Challenges & Solutions:
- **GPS accuracy in mountain terrain:**
  - Solution: QR code scanning as primary, GPS validation as secondary check
  - Allow admin to set larger radius tolerance for mountain locations

- **Offline functionality:**
  - Solution: Service workers via next-pwa
  - Cache: Map tiles, sign data, user progress in IndexedDB
  - Sync when back online via Supabase client

- **QR code damage/weathering:**
  - Solution: High-quality laminated signs
  - Backup: Manual code entry (admin-generated backup codes)

- **Supabase Free Tier Limits:**
  - 50K MAU: Monitor user growth, upgrade plan when needed ($25/month)
  - 500MB database: Optimize storage, archive old data
  - 1GB file storage: Compress images, use CDN

---

## 11. Adoption & Onboarding Strategy

### For Resorts:
1. **Quick Setup:**
   - Pre-built templates (winter sports theme)
   - CSV import for bulk sign creation
   - One-click map integration (if resort has trail map API)

2. **Documentation:**
   - Video tutorials for admin panel
   - QR code printing guidelines
   - Sign placement best practices
   - Integration guides for IT teams

3. **Support:**
   - Dedicated onboarding call
   - Email support during setup
   - Knowledge base/articles

4. **Marketing Materials:**
   - Guest-facing flyers/QR codes
   - Social media templates
   - Lift ticket inserts

### For Guests:
- **Zero-friction signup:** Email or pass number only
- **Quick tutorial:** 30-second onboarding flow
- **Help section:** FAQ, contact resort support
- **No app download required:** Works in mobile browser

---

## 12. Success Metrics

### For Resorts:
- Guest engagement rate
- Completion percentage
- Social media shares
- Return visitor correlation

### For Your Company:
- Number of resort clients
- Monthly recurring revenue
- Customer satisfaction (NPS)
- Feature adoption rates

---

## Next Steps

1. **Validate assumptions** with 1-2 pilot resorts
2. **Set up development environment** (Next.js + Supabase accounts)
3. **Build MVP** with core features only
4. **Beta test** with single resort
5. **Iterate** based on feedback
6. **Scale** to multiple resorts

