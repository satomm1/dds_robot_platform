# Robot-side task: replace the rigid map transform with a Thin Plate Spline (TPS)

You are working in the robot's DDS codebase (`mattbot_dds`). The central node in `dds_robot_platform` is switching from a rigid SE(2) map transform to a TPS warp fitted to the same known points. The robot side has to make the same switch. Otherwise robot poses, detections and goals will disagree with the central node wherever the maps are not rigidly aligned.

## Background: how the swarm frame works today
- Every agent has its own occupancy map and a `known_points.txt` file. Each line is `x,y` in meters, in that map's frame.
- On entry, an agent broadcasts `EntryExit(..., 'enter', ...)`. An existing agent replies with an `Initialization` message whose `known_points` field is a JSON list of `[x, y]`: the **reference** points.
- If nobody replies within about 3 s, the agent is the first one, and its own points become the reference. That gives an identity transform.
- The agent fits `ref ≈ R @ p + t` with Kabsch/SVD, which is usually called `estimate_se2` or `create_transform`.
- It then applies the fit with something like `transform_se2(R, t, (x, y, theta), forward)`:
  - **forward** (local → reference) to data it publishes: `Location`, paths, detections and similar.
  - **inverse** (reference → local) to commands it receives: goals, multi-robot goals and `position_init`.
  - Headings are shifted by `atan2(R[1,0], R[0,0])`.

The central node expects everything robots publish to already be in the **reference frame**. It sends goals and initial poses in the reference frame. That contract does not change.

## What changes
- The transform becomes a TPS that passes exactly through every known-point pair.
- **Headings** are rotated by the warp's local Jacobian at that position, not by one global angle.
- **The inverse** is solved exactly with Newton iterations on the forward spline, so forward and inverse round-trip with no drift.
- **Fallback:** if fewer than 4 point pairs exist, or the TPS solve fails, use the rigid fit as before. With 3 pairs a TPS degenerates to an affine fit that can shear or scale, which we don't want.

**Nothing changes on the wire:**
- The DDS IDL is unchanged.
- The `Initialization.known_points` format is unchanged.
- No new topics.

## Steps

### 1. Vendor the shared module
Copy `dds/dds_utils/transform.py` from `dds_robot_platform` **verbatim** into the robot codebase, next to wherever the current `transform_se2` / `estimate_se2` lives. Replace the old functions; the file keeps `estimate_se2`, `transform_se2` and `load_known_points` with the same signatures. It needs only numpy.

Do not re-implement the math. Both sides must produce identical results from the same points.

Public API:
```python
from transform import build_map_transform, load_known_points

tf = build_map_transform(my_points, reference_points, mode="tps", smooth=0.0)
# tf is a TpsMapTransform or a RigidMapTransform; both expose:
tf.apply((x, y, theta), forward=True)   # -> np.array([x', y', theta'])   (2-element input -> 2-element output)
tf.apply_xy(np.array([[x, y], ...]), forward=True)  # vectorized, positions only
tf.model            # "tps" or "rigid"
tf.fallback_reason  # None, or why a requested TPS fell back to rigid
tf.R, tf.t          # rigid approximation (always present)
```
`forward=True` means local → reference, matching the current `transform_se2` convention.

### 2. Add config
Add these next to the existing DDS config, overridable by environment variables:
```python
TRANSFORM_MODE = os.environ.get("TRANSFORM_MODE", "tps")   # "tps" | "rigid"
TPS_SMOOTH = float(os.environ.get("TPS_SMOOTH", "0.0"))
```
These must match the central node's values. The defaults above are the central defaults.

### 3. Replace where the transform is built
Search for where R and t are computed. Likely names are `create_transform`, `estimate_se2`, `np.linalg.svd`, `reference_known_points` and `known_points`. Replace the fit with:
```python
self.map_tf = build_map_transform(self.known_points, self.reference_known_points, TRANSFORM_MODE, TPS_SMOOTH)
log(f"map transform model={self.map_tf.model}" + (f" (fallback: {self.map_tf.fallback_reason})" if self.map_tf.fallback_reason else ""))
```
If other code still needs `self.R` / `self.t`, set them from `self.map_tf.R` / `self.map_tf.t`. That should only be a temporary bridge.

If R and t are passed into other components (listeners, threads, ROS nodes), pass `self.map_tf` instead.

### 4. Replace every place the transform is applied
Find every use: `grep -rn "transform_se2\|self\.R\b\|R @\|R\.T\|atan2(R\[1" .` Then:
- Replace `transform_se2(R, t, p, forward)` with `map_tf.apply(p, forward)`. **Keep the same `forward` value at each call site.**
- Replace hand-written `R @ xy + t`, `R.T @ (xy - t)`, and `theta ± atan2(R[1,0], R[0,0])` with `map_tf.apply(...)`, or with `map_tf.apply_xy(...)` for batches of positions.
- If a call site passes a dummy theta (`[x, y, 0.0]`) and throws it away, you can pass `[x, y]` instead. A 2-element input returns a 2-element output.
- Keep the `None` guard: if no transform exists yet, pass the data through unchanged, as the code does today.

Data that needs this (check that each is covered):
- **Outgoing, forward:** robot `Location` pose (x, y, θ); planned or smoothed path poses; object, person and sensor detections; goal echoes and `invalid_goal` reports. That covers anything published in map coordinates.
- **Incoming, inverse:** `goal`, `multi_robot_goal` and `position_init` (x, y, θ), plus anything else the central node sends in map coordinates.

### 5. Whole-map or raster transforms
If the robot code transforms an entire occupancy grid, costmap or laser scan with R and t (for example resampling a map into the reference frame), TPS can't be expressed as a single matrix. Use `apply_xy` on cell centers or scan endpoints. That is inverse mapping for rasters: for each output cell, `apply_xy(cell_xy, forward=False)` gives the source location to sample. If this is on a hot path, report it rather than guessing. A rigid approximation via `map_tf.R`/`map_tf.t` may be acceptable there.

### 6. Known points
- **Count:** each robot's `known_points.txt` needs **at least 4 points**, ideally 6–10, spread across the whole map. The points can't be collinear.
- **Order:** the line order must match the reference file one-to-one.
- **Fewer points:** with fewer, the code silently uses rigid. Make sure that is logged.

### 7. If the robot reads the transform from GraphQL
If any robot component queries the central GraphQL `transform` field, request `R t model src_points dst_points smooth timestamp`. Rebuild with `map_transform_from_doc(doc)`, which is in the same module. It returns None for the server's empty placeholder.

## Tests to add
- **Rigid data:** with ≥4 pairs related by a pure rotation and translation, `build_map_transform(..., "tps")` matches `estimate_se2` at arbitrary points (within 1e-6).
- **Round trip:** with warped synthetic data, `tf.apply(tf.apply(pose, True), False)` returns the pose (x, y, θ) to 1e-6.
- **Fallback:** 3 pairs → `tf.model == "rigid"` and `fallback_reason` is set. `TRANSFORM_MODE="rigid"` → rigid.
- **Identity:** identical point lists (the first agent) → identity rigid transform.
- **Call sites:** a unit test per publisher or subscriber that a pose passes through `map_tf` in the right direction. A mock that records `forward` is enough.

## Performance
A single `apply` costs tens of microseconds for about 10 points, and the inverse adds a few Newton steps. That is fine at pose and goal rates. For large batches (scans, paths), use `apply_xy`, which is vectorized.

## Done when
- The robot logs `map transform model=tps` with ≥4 matched points.
- With the central node also in TPS mode, the robot pose in the GUI sits on the correct corridor across the whole building, not only near the points.
- A goal clicked in the GUI is reached at the clicked spot, and the echoed goal matches it.
- `TRANSFORM_MODE=rigid` reproduces the old behavior exactly.
