"""
Preview a Thin Plate Spline (TPS) map transform next to the rigid SE(2) one.

Standalone experiment - not used by the DDS stack. Fits a TPS from --points
(in --map frame) to --ref-points (in --ref-map frame), warps --map into the
reference frame and draws it over the reference map, alongside the rigid
estimate_se2() result for comparison.

TPS needs >= 3 non-collinear pairs. With exactly 3 it reduces to an affine
fit (no bending); more well-spread points are needed to see real non-rigid
correction. --smooth > 0 trades exact interpolation for a smoother warp.

Example:
    python preview_tps.py \
        --map y2e2_tall.json --points y2e2_tall_known_points.txt \
        --ref-map y2e2_aligned.json --ref-points y2e2_aligned_known_points.txt
"""

import argparse

import numpy as np

from preview_transform import (
    draw_points,
    extent,
    load_known_points,
    load_map,
    map_corners,
    overlay_rgb,
    sample,
    to_rgb,
)
from transform import TPS2D, TpsMapTransform, estimate_se2  # dds_utils/transform.py, via preview_transform


def rigid_fn(R, t):
    return lambda xy: np.atleast_2d(xy) @ R.T + t


def fit_rigid(src, dst):
    R, t = estimate_se2(src.tolist(), dst.tolist())
    return R, np.asarray(t, dtype=float).reshape(2)


def leave_one_out(src, dst, fit):
    """Prediction error at each point when that point is left out of the fit."""
    errs = []
    for i in range(len(src)):
        keep = np.arange(len(src)) != i
        f = fit(src[keep], dst[keep])
        errs.append(float(np.linalg.norm(f(src[i:i + 1])[0] - dst[i])))
    return np.array(errs)


def rms(x):
    return float(np.sqrt(np.mean(np.asarray(x) ** 2)))


def canvas_for(ref, mine_corners_in_ref):
    corners = np.vstack([map_corners(ref), mine_corners_in_ref])
    xmin, ymin = corners.min(axis=0)
    xmax, ymax = corners.max(axis=0)
    res = ref['res']
    xs = np.arange(xmin, xmax, res) + res / 2
    ys = np.arange(ymin, ymax, res) + res / 2
    gx, gy = np.meshgrid(xs, ys)
    q = np.column_stack([gx.ravel(), gy.ravel()])
    ext = [xmin, xmin + len(xs) * res, ymin, ymin + len(ys) * res]
    return q, gx.shape, ext


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--map', required=True, help='map JSON to transform (this agent)')
    parser.add_argument('--points', required=True, help='known points in --map frame')
    parser.add_argument('--ref-map', required=True, help='reference map JSON')
    parser.add_argument('--ref-points', required=True, help='known points in --ref-map frame')
    parser.add_argument('--smooth', type=float, default=0.0,
                        help='TPS regularization (0 = exact interpolation through every point)')
    parser.add_argument('--save', help='write the figure to this path instead of showing it')
    args = parser.parse_args()

    pts = np.array(load_known_points(args.points))
    ref_pts = np.array(load_known_points(args.ref_points))
    if len(pts) != len(ref_pts):
        raise SystemExit(f'known point count mismatch: {len(pts)} vs {len(ref_pts)}')

    R, t = fit_rigid(pts, ref_pts)
    rigid = rigid_fn(R, t)
    tps = TpsMapTransform(pts.tolist(), ref_pts.tolist(), args.smooth)  # same model the DDS runtime uses
    tps_fwd = tps.fwd

    theta = np.degrees(np.arctan2(R[1, 0], R[0, 0]))
    rigid_res = np.linalg.norm(rigid(pts) - ref_pts, axis=1)
    tps_res = np.linalg.norm(tps_fwd(pts) - ref_pts, axis=1)
    print(f'rigid: theta = {theta:.3f} deg, t = ({t[0]:.4f}, {t[1]:.4f}) m')
    print(f'TPS:   smooth = {args.smooth}, bending energy = {tps_fwd.bending_energy():.4g}')
    print(f'{"pt":>3} {"rigid res":>10} {"TPS res":>10}' + (f' {"rigid LOO":>10} {"TPS LOO":>10}' if len(pts) >= 4 else ''))
    loo_rigid = loo_tps = None
    if len(pts) >= 4:
        loo_rigid = leave_one_out(pts, ref_pts, lambda s, d: rigid_fn(*fit_rigid(s, d)))
        loo_tps = leave_one_out(pts, ref_pts, lambda s, d: TPS2D(s, d, args.smooth))
    for i in range(len(pts)):
        line = f'{i + 1:>3} {rigid_res[i]:>9.3f}m {tps_res[i]:>9.3f}m'
        if loo_rigid is not None:
            line += f' {loo_rigid[i]:>9.3f}m {loo_tps[i]:>9.3f}m'
        print(line)
    print(f'RMS {rms(rigid_res):>9.3f}m {rms(tps_res):>9.3f}m'
          + (f' {rms(loo_rigid):>9.3f}m {rms(loo_tps):>9.3f}m' if loo_rigid is not None else ''))
    if len(pts) == 3:
        print('NOTE: with 3 points TPS is a pure affine fit (exact, no bending). Add points for a real TPS.')
    if loo_rigid is None:
        print('NOTE: leave-one-out needs >= 4 points.')
    else:
        print('LOO = error at a point when it is held out of the fit; lower means the model generalizes better.')

    probe = np.vstack([pts, ref_pts]) + np.random.default_rng(0).normal(0, 5, (2 * len(pts), 2))
    roundtrip = np.abs(tps.apply_xy(tps.apply_xy(probe), forward=False) - probe).max()
    print(f'TPS forward/inverse round-trip error: {roundtrip:.2e} m')

    mine = load_map(args.map)
    ref = load_map(args.ref_map)

    # Common canvas covering the reference map and both warped versions of my map.
    corners = map_corners(mine)
    q, shape, ext = canvas_for(ref, np.vstack([rigid(corners), tps_fwd(corners)]))
    ref_on_canvas = sample(ref, q).reshape(shape)
    rigid_warped = sample(mine, (q - t) @ R).reshape(shape)
    tps_warped = sample(mine, tps.apply_xy(q, forward=False)).reshape(shape)

    # How far TPS moves each point of my map relative to the rigid fit.
    h, w = mine['grid'].shape
    step = max(1, int(round(0.5 / mine['res'])))
    cols, rows = np.meshgrid(np.arange(0, w, step), np.arange(0, h, step))
    m_xy = np.column_stack([(cols.ravel() + 0.5) * mine['res'], (rows.ravel() + 0.5) * mine['res']])
    c, s = np.cos(mine['yaw']), np.sin(mine['yaw'])
    m_xy = m_xy @ np.array([[c, -s], [s, c]]).T + mine['origin']
    dev = np.linalg.norm(tps_fwd(m_xy) - rigid(m_xy), axis=1).reshape(cols.shape)
    known = sample(mine, m_xy).reshape(cols.shape) >= 0
    dev = np.where(known, dev, np.nan)

    if args.save:
        import matplotlib
        matplotlib.use('Agg')
    import matplotlib.pyplot as plt

    fig, axes = plt.subplots(2, 2, figsize=(18, 13))

    ax = axes[0, 0]
    ax.imshow(to_rgb(mine['grid']), origin='lower', extent=extent(mine), interpolation='nearest')
    draw_points(ax, pts, 'x', 'red')
    ax.set_title(f'Map: {args.map}')

    ax = axes[0, 1]
    im = ax.imshow(dev, origin='lower', extent=extent(mine), cmap='viridis', interpolation='nearest')
    fig.colorbar(im, ax=ax, label='|TPS − rigid| [m]', shrink=0.8)
    draw_points(ax, pts, 'x', 'red')
    ax.set_title(f'TPS deviation from rigid (map frame), max {np.nanmax(dev):.2f} m')

    for ax, warped, f, name, res in [
        (axes[1, 0], rigid_warped, rigid, f'Rigid  θ={theta:.2f}°', rigid_res),
        (axes[1, 1], tps_warped, tps_fwd, f'TPS  smooth={args.smooth}', tps_res),
    ]:
        ax.imshow(overlay_rgb(warped, ref_on_canvas), origin='lower', extent=ext, interpolation='nearest')
        moved = f(pts)
        for a, b in zip(moved, ref_pts):
            ax.plot([a[0], b[0]], [a[1], b[1]], '-', color='orange', linewidth=1.5)
        draw_points(ax, ref_pts, 'o', 'blue')
        draw_points(ax, moved, 'x', 'red')
        title = f'{name}  RMS={rms(res):.3f} m'
        if loo_rigid is not None:
            title += f'  LOO RMS={rms(loo_rigid if f is rigid else loo_tps):.3f} m'
        ax.set_title(title + '\nblue = ref only, red = map only, black = both')

    for ax in axes.ravel():
        ax.set_xlabel('x [m]')
        ax.set_ylabel('y [m]')
        ax.set_aspect('equal')

    fig.tight_layout()
    if args.save:
        fig.savefig(args.save, dpi=130)
        print(f'saved {args.save}')
    else:
        plt.show()


if __name__ == '__main__':
    main()
