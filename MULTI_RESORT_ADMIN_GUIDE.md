# Multi-Resort Admin Guide

## Overview

The system supports three types of admin access:

1. **Super Admin** (`is_admin = true` in `user_metadata`)
   - Can manage ALL resorts
   - Set once, applies to everything

2. **Multi-Resort Admin** (via `resort_admins` table) ⭐ **Recommended**
   - Can manage specific resorts
   - One user can be admin of multiple resorts
   - Flexible and scalable

3. **Legacy Single-Resort Admin** (via `user_metadata.resort_id`)
   - Can manage one specific resort
   - Still supported for backward compatibility
   - Consider migrating to `resort_admins` table

## Database Schema

### New Table: `resort_admins`

```sql
CREATE TABLE resort_admins (
  id uuid PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id),
  resort_id uuid REFERENCES resorts(id),
  created_at timestamptz DEFAULT now(),
  UNIQUE(user_id, resort_id) -- Prevents duplicate assignments
);
```

This creates a **many-to-many relationship**:
- One user can be admin of multiple resorts
- One resort can have multiple admins

## How to Assign Multi-Resort Admins

### Option 1: Using the Management Script (Recommended)

```bash
# Add user as admin of a resort
npx tsx scripts/manage-resort-admin.ts add user@example.com aspen-mountain

# Add same user to another resort
npx tsx scripts/manage-resort-admin.ts add user@example.com vail-resort

# List all resorts a user is admin of
npx tsx scripts/manage-resort-admin.ts list user@example.com

# List all admins of a resort
npx tsx scripts/manage-resort-admin.ts list-admins aspen-mountain

# Remove user as admin of a resort
npx tsx scripts/manage-resort-admin.ts remove user@example.com aspen-mountain
```

### Option 2: Using SQL Directly

```sql
-- Add user as admin of a resort
INSERT INTO resort_admins (user_id, resort_id)
VALUES (
  'user-uuid-here',
  'resort-uuid-here'
);

-- Add same user to multiple resorts
INSERT INTO resort_admins (user_id, resort_id)
VALUES 
  ('user-uuid', 'resort-1-uuid'),
  ('user-uuid', 'resort-2-uuid'),
  ('user-uuid', 'resort-3-uuid');

-- Remove user as admin of a resort
DELETE FROM resort_admins
WHERE user_id = 'user-uuid' AND resort_id = 'resort-uuid';

-- List all resorts a user is admin of
SELECT r.name, r.slug
FROM resort_admins ra
JOIN resorts r ON r.id = ra.resort_id
WHERE ra.user_id = 'user-uuid';

-- List all admins of a resort
SELECT u.email
FROM resort_admins ra
JOIN auth.users u ON u.id = ra.user_id
WHERE ra.resort_id = 'resort-uuid';
```

### Option 3: Using Supabase Dashboard

1. Go to **Table Editor** → `resort_admins`
2. Click **Insert row**
3. Fill in:
   - `user_id`: UUID of the user (from `auth.users`)
   - `resort_id`: UUID of the resort (from `resorts`)
4. Click **Save**

## Migration from Legacy System

If you have existing admins using the old `user_metadata.resort_id` method, you can migrate them:

```sql
-- Migrate existing single-resort admins to new table
INSERT INTO resort_admins (user_id, resort_id)
SELECT id, resort_id
FROM user_metadata
WHERE resort_id IS NOT NULL
ON CONFLICT (user_id, resort_id) DO NOTHING;
```

**Note:** The system still supports the legacy method, so migration is optional but recommended for consistency.

## How Permissions Work

### Code-Level Checks

The `isResortAdmin()` function checks all three methods:

```typescript
// lib/utils/admin.ts
export async function isResortAdmin(resortId: string): Promise<boolean> {
  // 1. Check if super admin
  if (isAdmin()) return true
  
  // 2. Check resort_admins table (new way)
  const { data } = await supabase
    .from('resort_admins')
    .select('id')
    .eq('user_id', user.id)
    .eq('resort_id', resortId)
    .maybeSingle()
  
  if (data) return true
  
  // 3. Check legacy user_metadata.resort_id (backward compatibility)
  return metadata?.resort_id === resortId
}
```

### Database-Level Checks (RLS)

Row Level Security policies check all three methods:

```sql
-- Example: Signs can be managed by:
-- 1. Super admins (is_admin = true)
-- 2. Users in resort_admins table
-- 3. Legacy: users with resort_id in user_metadata
CREATE POLICY "Signs can be managed by super admins or resort admins"
  ON signs FOR ALL
  USING (
    -- Super admin check
    EXISTS (SELECT 1 FROM user_metadata WHERE id = auth.uid() AND is_admin = true)
    OR
    -- New multi-resort admin check
    EXISTS (SELECT 1 FROM resort_admins WHERE user_id = auth.uid() AND resort_id = signs.resort_id)
    OR
    -- Legacy single-resort admin check
    EXISTS (SELECT 1 FROM user_metadata WHERE id = auth.uid() AND resort_id = signs.resort_id)
  );
```

## Use Cases

### Use Case 1: Regional Manager
**Scenario:** Sarah manages 3 resorts in Colorado

```bash
# Add Sarah as admin of all 3 resorts
npx tsx scripts/manage-resort-admin.ts add sarah@company.com aspen-mountain
npx tsx scripts/manage-resort-admin.ts add sarah@company.com vail-resort
npx tsx scripts/manage-resort-admin.ts add sarah@company.com breckenridge-resort
```

**Result:** Sarah can access admin panels for all 3 resorts at:
- `/aspen-mountain/admin`
- `/vail-resort/admin`
- `/breckenridge-resort/admin`

### Use Case 2: Super Admin
**Scenario:** You (the platform owner) need to manage all resorts

```sql
-- Set yourself as super admin (one-time setup)
UPDATE user_metadata
SET is_admin = true
WHERE id = 'your-user-uuid';
```

**Result:** You can access any resort's admin panel without individual assignments.

### Use Case 3: Temporary Admin Access
**Scenario:** Give a consultant temporary access to one resort

```bash
# Add consultant
npx tsx scripts/manage-resort-admin.ts add consultant@example.com aspen-mountain

# Later, remove access
npx tsx scripts/manage-resort-admin.ts remove consultant@example.com aspen-mountain
```

## Best Practices

1. **Use `resort_admins` table for new assignments**
   - More flexible than legacy method
   - Supports multiple resorts per user
   - Easier to manage

2. **Use Super Admin sparingly**
   - Only for platform owners/developers
   - Too powerful for regular resort managers

3. **Document admin assignments**
   - Keep track of who has access to what
   - Review periodically for security

4. **Use the management script**
   - Less error-prone than manual SQL
   - Validates inputs
   - Shows helpful error messages

## Troubleshooting

### User can't access admin panel
**Check:**
1. Is user a super admin? `SELECT is_admin FROM user_metadata WHERE id = 'user-uuid'`
2. Is user in `resort_admins` table? `SELECT * FROM resort_admins WHERE user_id = 'user-uuid'`
3. Is user's `resort_id` set? `SELECT resort_id FROM user_metadata WHERE id = 'user-uuid'`

### User can access wrong resort
**Check:** RLS policies might be too permissive. Verify the policies check `resort_id` correctly.

### Duplicate admin assignments
**Prevented:** The `UNIQUE(user_id, resort_id)` constraint prevents duplicates.

## API Functions

### Get All Resorts User Can Admin

```typescript
import { getAdminResorts } from '@/lib/utils/admin'

const resortIds = await getAdminResorts()
// Returns: ['resort-1-uuid', 'resort-2-uuid', ...]
// For super admins: returns all resort IDs
```

### Check Specific Resort Access

```typescript
import { isResortAdmin } from '@/lib/utils/admin'

const canManage = await isResortAdmin(resortId)
// Returns: true if user can manage this resort
```

## Summary

✅ **Multi-resort admins:** Use `resort_admins` table  
✅ **Super admins:** Use `user_metadata.is_admin = true`  
✅ **Legacy support:** `user_metadata.resort_id` still works  
✅ **Management:** Use `scripts/manage-resort-admin.ts`  
✅ **Flexible:** One user can admin multiple resorts  

The system is backward compatible, so existing single-resort admins continue to work while you migrate to the new system.

