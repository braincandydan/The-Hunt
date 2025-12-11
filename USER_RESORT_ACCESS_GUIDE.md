# User Resort Access Guide

## Overview

The system supports **open game access** - any authenticated user can play at any resort. The system automatically tracks which resorts a user has joined/played at.

## How It Works

### Game Access is Open ✅

**Any authenticated user can access any resort's game:**
- User signs up at Resort A → Can play at Resort A
- User visits Resort B → Can also play at Resort B (no signup needed)
- User visits Resort C → Can also play at Resort C

**No restrictions!** Users can play at as many resorts as they want.

### Automatic Tracking

The system automatically tracks which resorts a user has joined:

1. **On Signup:** When user signs up at a resort, they're added to `user_resorts` table
2. **On First Access:** When user first accesses a resort's game, they're automatically added
3. **On First Discovery:** When user scans their first QR code at a resort, they're automatically added

### Database Schema

#### `user_resorts` Table

```sql
CREATE TABLE user_resorts (
  id uuid PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id),
  resort_id uuid REFERENCES resorts(id),
  joined_at timestamptz DEFAULT now(),
  last_activity_at timestamptz DEFAULT now(),
  completed boolean DEFAULT false,
  completed_at timestamptz,
  UNIQUE(user_id, resort_id)
);
```

**Purpose:**
- Tracks which resorts a user has played at
- Records when they joined each resort
- Tracks last activity (auto-updated on discoveries)
- Tracks completion status

#### `user_metadata.resort_id` (Legacy/Primary Resort)

The `user_metadata.resort_id` field is now used as:
- **Primary/Home Resort:** The resort where user first signed up
- **Default Resort:** For display purposes (e.g., "Welcome back to [resort]")
- **Backward Compatibility:** Still works with existing code

## User Flow Examples

### Example 1: User Signs Up at Resort A

1. User visits `/aspen-mountain/login`
2. User signs up with email/password
3. System:
   - Creates auth user
   - Adds to `user_resorts` (aspen-mountain)
   - Sets `user_metadata.resort_id` = aspen-mountain (primary resort)
4. User can now play at aspen-mountain

### Example 2: User Visits Another Resort

1. User (already signed up) visits `/vail-resort/game/map`
2. System:
   - Checks if user is logged in ✅
   - Checks if user has joined vail-resort
   - If not, automatically adds to `user_resorts` (vail-resort)
3. User can now play at vail-resort
4. User's discoveries at vail-resort are separate from aspen-mountain

### Example 3: User Makes Discovery at New Resort

1. User visits `/breckenridge-resort/game/map` (first time)
2. User scans a QR code
3. System:
   - Creates discovery record
   - Trigger automatically adds user to `user_resorts` (breckenridge-resort)
   - Updates `last_activity_at` for breckenridge-resort
4. User is now "joined" to breckenridge-resort

## Data Isolation

### User Discoveries

User discoveries are **automatically isolated** by resort:

```typescript
// When user scans QR code at Resort A
// Discovery is linked to Sign A (which belongs to Resort A)

// When user scans QR code at Resort B  
// Discovery is linked to Sign B (which belongs to Resort B)

// These are separate - no cross-contamination
```

**How it works:**
- `user_discoveries` table has `sign_id`
- `signs` table has `resort_id`
- Queries filter by `resort_id` when showing progress

### Progress Tracking

Each resort tracks progress separately:

```typescript
// Resort A: User found 5/10 signs
// Resort B: User found 3/8 signs
// Resort C: User found 0/12 signs (just joined, no discoveries yet)
```

## API Functions

### Get User's Resorts

```typescript
import { getUserResorts } from '@/lib/utils/user-resorts'

const resorts = await getUserResorts()
// Returns: [
//   {
//     resort_id: '...',
//     resort: { id: '...', name: 'Aspen Mountain', slug: 'aspen-mountain' },
//     joined_at: '2024-01-15T10:00:00Z',
//     last_activity_at: '2024-01-20T14:30:00Z',
//     completed: false
//   },
//   ...
// ]
```

### Check if User Joined Resort

```typescript
import { hasJoinedResort } from '@/lib/utils/user-resorts'

const joined = await hasJoinedResort(resortId)
// Returns: true if user has joined this resort
```

### Auto-Join Resort

```typescript
import { autoJoinResortIfNeeded } from '@/lib/utils/auto-join-resort'

// Automatically joins resort if user hasn't joined yet
await autoJoinResortIfNeeded(resortId)
```

## UI Features You Can Build

### 1. "Your Resorts" List

Show user all resorts they've played at:

```typescript
const userResorts = await getUserResorts()

// Display:
// - Aspen Mountain (5/10 signs found, last played: 2 days ago)
// - Vail Resort (3/8 signs found, last played: 1 week ago)
// - Breckenridge (0/12 signs found, just joined)
```

### 2. Resort Switcher

Allow users to quickly switch between resorts:

```typescript
// Dropdown or menu showing:
// - Aspen Mountain (current)
// - Vail Resort
// - Breckenridge
// - + Join New Resort (links to resort list)
```

### 3. Progress Dashboard

Show progress across all resorts:

```typescript
// "You've played at 3 resorts:
// - Aspen: 50% complete (5/10)
// - Vail: 37% complete (3/8)
// - Breckenridge: 0% complete (0/12)"
```

## Migration from Old System

If you have existing users with `user_metadata.resort_id` set:

```sql
-- Migrate existing users to user_resorts table
INSERT INTO user_resorts (user_id, resort_id, joined_at)
SELECT id, resort_id, created_at
FROM user_metadata
WHERE resort_id IS NOT NULL
ON CONFLICT (user_id, resort_id) DO NOTHING;
```

## Key Points

✅ **Game access is open** - Any authenticated user can play at any resort  
✅ **Automatic tracking** - System tracks which resorts user has joined  
✅ **Data isolation** - Discoveries are per-resort, no cross-contamination  
✅ **No restrictions** - Users can play at unlimited resorts  
✅ **Backward compatible** - `user_metadata.resort_id` still works as "primary resort"  

## Summary

**For Users:**
- Sign up once, play anywhere
- Visit any resort's game page and start playing
- Progress tracked separately per resort
- Can switch between resorts freely

**For Developers:**
- No need to check `resort_id` for game access
- Use `user_resorts` table to show "Your Resorts"
- Use `user_metadata.resort_id` for "primary/home resort"
- Discoveries automatically isolated by resort

The system is designed to be **user-friendly** - no barriers, just fun! 🎿

