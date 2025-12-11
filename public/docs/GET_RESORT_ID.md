# Getting Your Resort ID

When importing ski features, you need your **resort's UUID from your database**, NOT the OpenSkiMap ID.

## Method 1: Supabase Dashboard (Easiest)

1. Go to your Supabase Dashboard: https://app.supabase.com
2. Select your project
3. Go to **Table Editor** → `resorts` table
4. Find your resort row
5. Copy the `id` value (it's a UUID like `123e4567-e89b-12d3-a456-426614174000`)

## Method 2: SQL Editor

1. Go to Supabase Dashboard → **SQL Editor**
2. Run this query:

```sql
SELECT id, name, slug FROM resorts;
```

3. Copy the `id` for the resort you want to import features for

## Method 3: If You Don't Have a Resort Yet

Create one first:

```sql
INSERT INTO resorts (name, slug)
VALUES ('Big White Ski Resort', 'big-white')
RETURNING id, name, slug;
```

This will create the resort and return the new UUID.

## Important Notes

- ✅ **Use**: The UUID from your `resorts.id` column
- ❌ **Don't use**: The OpenSkiMap ID (`4e9295e870b927f90f542cd716b60fe0c2b04cb8`)
- The OpenSkiMap ID is just metadata stored in the JSON file
- Your resort UUID links the imported features to your resort

## Example

If your resort UUID is `a1b2c3d4-e5f6-7890-abcd-ef1234567890`, your import command would be:

```bash
npx tsx scripts/import-ski-features.ts "2719c1b8-49d7-474a-8d35-59cf9e70331b" docs/ski-area.json boundary
```

