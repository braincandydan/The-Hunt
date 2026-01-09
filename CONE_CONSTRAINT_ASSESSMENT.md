# Cone Constraint System Assessment

## Overview
The cone constraint system controls camera panning by creating an irregular "mountain-shaped" cone surface that the camera's focus point (red dot) must stay on. This prevents the camera from panning too far from the mountain while allowing natural movement.

## Architecture

### 1. Cone Profile Calculation (`calculateMountainConeProfile`)

**Purpose**: Creates a 3D cone profile based on actual trail geometry.

**Process**:
1. **Collects all trail points** from ski features (trails and lifts)
2. **Finds highest point** - the peak of the mountain
3. **Finds 6 furthest points** - one in each of 6 directions (60° apart) from the highest point
4. **Creates radius map**: 
   - Top (Y=0): All 6 directions use same radius = distance from `centerPoint` to `highestPoint`
   - Bottom (Y=9): Each direction uses distance from `centerPoint` to its furthest point
   - Intermediate levels (Y=1-8): Linear interpolation between top and bottom

**Key Parameters**:
- `NUM_DIRECTIONS = 6` (hexagonal base)
- `Y_SAMPLE_LEVELS = 10` (10 vertical levels for interpolation)
- `centerPoint`: Mountain center (highest point with Y offset)

**Issues Identified**:

1. **Reference Angle Logic (Lines 516-519)**:
   ```typescript
   const dxRef = centerPoint.x - highestPoint.x
   const dzRef = centerPoint.z - highestPoint.z
   const referenceAngle = Math.atan2(dzRef, dxRef)
   ```
   - Uses `centerPoint` as reference, but `centerPoint` is just `highestPoint` with Y offset
   - This means direction 0 is always toward where the center point is, which may not be meaningful
   - **Suggestion**: Consider using a fixed reference (e.g., north = 0°) or the average trail direction

2. **Top Radius Calculation (Lines 546-555)**:
   ```typescript
   const distToHighest = Math.sqrt(dxToHighest * dxToHighest + dzToHighest * dzToHighest)
   // All top points use the same radius (distance from center to highest point)
   for (let dir = 0; dir < NUM_DIRECTIONS; dir++) {
     radiusByDirection.get(dir)!.set(0, distToHighest)
   }
   ```
   - All 6 directions at the top use the same radius
   - This creates a circular top, not a cone top
   - **Issue**: If the highest point is offset from center, this creates a dome at the top
   - **Suggestion**: Consider making top radius smaller (e.g., 0 or 5% of max) to create a true cone

3. **Bottom Point Y Mapping (Lines 567-574)**:
   ```typescript
   const yLevel = yRange > 0 
     ? Math.round(((bottomPoint.y - minY) / yRange) * (Y_SAMPLE_LEVELS - 1))
     : Y_SAMPLE_LEVELS - 1
   ```
   - Maps bottom point's actual Y to a sample level
   - Then also sets it at level 9 (bottom)
   - **Issue**: This creates a discontinuity - the point's actual Y might not be at the bottom
   - **Suggestion**: Use the point's actual Y level for that direction, don't duplicate at bottom

4. **Fallback Radius (Lines 579-581)**:
   ```typescript
   const fallbackRadius = distToHighest + 5000
   ```
   - If no point found in a direction, uses `distToHighest + 5000`
   - **Issue**: This is arbitrary and may not match the actual trail extent
   - **Suggestion**: Use the average of other directions or the max distance found

### 2. Radius Interpolation (`getRadiusForDirectionAndY` & `getRadiusForAngleAndY`)

**Purpose**: Smoothly interpolate radius for any angle and Y position.

**Process**:
1. **Y interpolation**: Linear interpolation between sample levels (0-9)
2. **Angle interpolation**: Linear interpolation between adjacent directions (0-5)

**Issues Identified**:

1. **Y Progress Calculation (Line 642)**:
   ```typescript
   const yProgress = Math.max(0, Math.min(1, (maxY - y) / yRange))
   ```
   - `yProgress = 0` at top (maxY), `yProgress = 1` at bottom (minY)
   - This is correct for the interpolation logic

2. **Angle Normalization (Line 672)**:
   ```typescript
   const normalizedAngle = ((angle % (Math.PI * 2)) + (Math.PI * 2)) % (Math.PI * 2)
   ```
   - Handles negative angles and wraps to 0-2π
   - **Issue**: The modulo operation `% (Math.PI * 2)` on a potentially negative number can be problematic
   - **Suggestion**: Use `((angle % (Math.PI * 2)) + (Math.PI * 2)) % (Math.PI * 2)` is correct, but could be simplified

### 3. Cone Constraint Application (`applyMountainConeConstraint`)

**Purpose**: Projects the focus point onto the cone surface.

**Process**:
1. Clamps Y to valid range (with optional `lowestConePointY` minimum)
2. Calculates angle from center to focus point
3. Gets radius for that angle and Y using interpolation
4. Projects point to cone surface at that radius

**Issues Identified**:

1. **No Minimum Radius (Line 808)**:
   ```typescript
   // NO minimum radius constraint - let the red dot follow the true cone surface shape
   ```
   - Comment says no minimum, but the simple cone (`applyConeConstraint`) has a 5% minimum
   - **Issue**: At the top, if radius is very small, the red dot might be too close to center
   - **Suggestion**: Consider a small minimum radius (e.g., 1% of max) to prevent jittery behavior at top

2. **Y Clamping (Lines 787-790)**:
   ```typescript
   const effectiveMinY = lowestConePointY !== undefined ? lowestConePointY : minY
   constrained.y = Math.max(effectiveMinY, Math.min(maxY, focusPoint.y))
   ```
   - Uses `lowestConePointY` to prevent going below actual cone bottom
   - **Good**: This prevents the red dot from going below the actual terrain

### 4. Drag-Based Movement (in `useFrame`)

**Purpose**: Allows user to drag the focus point along the cone surface.

**Process**:
1. Vertical drag → changes Y (moves up/down cone)
2. Horizontal drag → changes angle (rotates around cone)
3. Recalculates radius for new Y and angle
4. Updates camera position based on new focus point

**Issues Identified**:

1. **Sensitivity (Line 1457)**:
   ```typescript
   const sensitivity = 1.2 // Adjust for responsiveness
   ```
   - Hardcoded sensitivity value
   - **Suggestion**: Make this configurable or adjust based on zoom level

2. **Y Delta Calculation (Line 1463)**:
   ```typescript
   const yDelta = (-deltaY / screenHeight) * yRangeSize * sensitivity
   ```
   - Negated for "intuitive control" (pull up = move down)
   - **Issue**: This might be counter-intuitive for some users
   - **Suggestion**: Consider making this configurable or matching standard UI conventions

3. **Angle Delta (Line 1475)**:
   ```typescript
   const angleDelta = (deltaX / screenWidth) * Math.PI * 2 * sensitivity
   ```
   - Full 2π rotation per screen width
   - **Issue**: This might be too sensitive or not sensitive enough depending on use case
   - **Suggestion**: Make configurable or adjust based on zoom level

## Overall Assessment

### Strengths
1. ✅ **Irregular cone shape** - Adapts to actual trail geometry, not a perfect cone
2. ✅ **Smooth interpolation** - Creates smooth surface between discrete sample points
3. ✅ **Y-based radius** - Radius changes with elevation, creating natural mountain shape
4. ✅ **Direction-based variation** - Different radii in different directions match trail layout

### Weaknesses
1. ⚠️ **Top radius logic** - All directions use same radius at top, creating a dome instead of cone
2. ⚠️ **Reference angle** - Uses centerPoint as reference, which may not be meaningful
3. ⚠️ **Fallback values** - Arbitrary fallback radii when no points found in a direction
4. ⚠️ **Hardcoded parameters** - Sensitivity, number of directions, sample levels are all hardcoded
5. ⚠️ **No minimum radius** - At top, radius can be very small, causing jittery behavior

### Recommendations

1. **Improve Top Radius**:
   - Consider making top radius smaller (e.g., 0 or 5% of max) to create a true cone
   - Or use the minimum radius from all directions at the top

2. **Better Reference Direction**:
   - Use a fixed reference (north = 0°) or calculate from trail distribution
   - This makes the cone orientation more predictable

3. **Smarter Fallbacks**:
   - When no point found in a direction, use average of adjacent directions
   - Or use the maximum distance found across all directions

4. **Configurable Parameters**:
   - Make sensitivity, number of directions, and sample levels configurable
   - Allow tuning for different resort sizes and shapes

5. **Add Minimum Radius**:
   - Add a small minimum radius (e.g., 1% of max) to prevent jittery behavior at top
   - This matches the simple cone constraint behavior

6. **Better Y Mapping**:
   - Don't duplicate bottom points at level 9 if their actual Y is higher
   - Use actual Y levels for each direction's bottom point

## Code Quality

- **Well-documented**: Functions have clear comments
- **Modular**: Logic is separated into reusable functions
- **Type-safe**: Uses TypeScript types appropriately
- **Error handling**: Has fallbacks for edge cases
- **Performance**: Uses efficient data structures (Maps) for lookups

## Testing Recommendations

1. Test with resorts that have:
   - Very spread out trails (wide base)
   - Tall, narrow mountains (small base)
   - Asymmetric trail layouts
   - Single trail (edge case)

2. Test drag behavior:
   - At top of cone (small radius)
   - At bottom of cone (large radius)
   - Near direction boundaries (interpolation)

3. Test edge cases:
   - No trails
   - Single point
   - All trails at same elevation
   - Trails in single direction

