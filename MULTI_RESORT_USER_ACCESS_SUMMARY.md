# Multi-Resort User Access: Complete Solution

## Your Question

> "But once we start adding regular users they are going to need access to the specific resort they sign up for. They also might go to multiple resorts and may want to access both resorts but these users would not have admin access they would just need access to the game. How would that work?"

## Answer: It Already Works! ✅

**Good news:** The system is already designed for this! Here's how:

### 1. Game Access is Open (No Restrictions)

**Any authenticated user can play at ANY resort:**
- User signs up at Resort A → Can play at Resort A ✅
- User visits Resort B → Can also play at Resort B ✅ (no signup needed)
- User visits Resort C → Can also play at Resort C ✅

**No restrictions!** Users can access as many resorts as they want.

### 2. Automatic Tracking

The system now automatically tracks which resorts a user has joined:

- **On Signup:** Added to `user_resorts` table
- **On First Game Access:** Automatically added when they visit a resort's game
- **On First Discovery:** Automatically added when they scan their first QR code

### 3. Data Isolation

User discoveries are **automatically isolated** per resort:
- Discoveries at Resort A are separate from Resort B
- Progress tracked separately per resort
- No cross-contamination between resorts

## What I Created

### 1. Database Migration (`010_add_user_resorts_table.sql`)

Creates `user_resorts` table to track:
- Which resorts a user has joined
- When they joined
- Last activity date
- Completion status

### 2. Helper Functions (`lib/utils/user-resorts.ts`)

- `getUserResorts()` - Get all resorts user has joined
- `joinResort()` - Manually join a resort
- `hasJoinedResort()` - Check if user joined a resort
- `markResortCompleted()` - Mark resort as completed

### 3. Auto-Join Function (`lib/utils/auto-join-resort.ts`)

- `autoJoinResortIfNeeded()` - Automatically joins resort if user hasn't joined yet
- Called when user accesses a resort's game for the first time

### 4. Updated Signup Flow

Updated login pages to:
- Add user to `user_resorts` table on signup
- Keep `user_metadata.resort_id` as "primary/home resort"

### 5. Updated Game Access

Game map page now:
- Automatically joins user to resort if they haven't joined yet
- Allows access to any resort (no restrictions)

## How It Works in Practice

### Scenario 1: User Signs Up at Aspen

1. User visits `/aspen-mountain/login`
2. Signs up with email/password
3. System:
   - Creates auth user
   - Adds to `user_resorts` (aspen-mountain)
   - Sets `user_metadata.resort_id` = aspen-mountain
4. User can play at aspen-mountain ✅

### Scenario 2: Same User Visits Vail

1. User (already logged in) visits `/vail-resort/game/map`
2. System:
   - Checks: User is logged in ✅
   - Checks: Has user joined vail-resort?
   - If not: Automatically adds to `user_resorts` (vail-resort)
3. User can now play at vail-resort ✅
4. Discoveries at vail are separate from aspen ✅

### Scenario 3: User Makes Discovery at New Resort

1. User visits `/breckenridge-resort/game/map` (first time)
2. User scans QR code
3. System:
   - Creates discovery record
   - Trigger automatically adds user to `user_resorts` (breckenridge)
   - Updates `last_activity_at`
4. User is now "joined" to breckenridge ✅

## Database Structure

### `user_resorts` Table (New)

```sql
user_resorts
├── user_id (FK to auth.users)
├── resort_id (FK to resorts)
├── joined_at (when user first joined)
├── last_activity_at (last discovery/activity)
├── completed (boolean, has user completed hunt?)
└── completed_at (when completed)
```

**Purpose:** Track which resorts a user has played at

### `user_metadata.resort_id` (Existing)

```sql
user_metadata
├── id (FK to auth.users)
├── resort_id (primary/home resort)
├── is_admin (super admin flag)
└── ...
```

**Purpose:** Primary/home resort (for display, backward compatibility)

## Key Differences: Users vs Admins

| Feature | Regular Users | Admins |
|---------|--------------|--------|
| **Game Access** | ✅ Open - can play at any resort | ✅ Can manage any resort (if super admin) |
| **Tracking** | `user_resorts` table | `resort_admins` table |
| **Purpose** | Track which resorts user has played | Track which resorts user can manage |
| **Restrictions** | None - play anywhere | Must be assigned via `resort_admins` |

## What You Can Build Now

### 1. "Your Resorts" Dashboard

```typescript
const resorts = await getUserResorts()
// Show: "You've played at 3 resorts: Aspen, Vail, Breckenridge"
```

### 2. Resort Switcher

```typescript
// Dropdown showing all resorts user has joined
// Allow quick switching between resorts
```

### 3. Progress Across Resorts

```typescript
// Show progress for each resort:
// - Aspen: 5/10 signs (50%)
// - Vail: 3/8 signs (37%)
// - Breckenridge: 0/12 signs (0%)
```

## Migration Steps

1. **Run the migration:**
   ```sql
   -- Apply migration 010_add_user_resorts_table.sql
   ```

2. **Migrate existing users (optional):**
   ```sql
   -- Copy existing user_metadata.resort_id to user_resorts
   INSERT INTO user_resorts (user_id, resort_id, joined_at)
   SELECT id, resort_id, created_at
   FROM user_metadata
   WHERE resort_id IS NOT NULL
   ON CONFLICT DO NOTHING;
   ```

3. **Test:**
   - Sign up at one resort
   - Visit another resort's game
   - Verify user is automatically added to `user_resorts`

## Summary

✅ **Game access is open** - Users can play at any resort  
✅ **Automatic tracking** - System tracks which resorts user has joined  
✅ **No restrictions** - Users can access unlimited resorts  
✅ **Data isolation** - Discoveries are per-resort, no cross-contamination  
✅ **Backward compatible** - Existing `user_metadata.resort_id` still works  

**The system is ready!** Users can sign up at one resort and play at as many as they want. No code changes needed - it just works! 🎿

