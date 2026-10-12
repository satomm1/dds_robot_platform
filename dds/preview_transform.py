"""
Preview the SE(2) map transform computed from known points.

Uses the same estimate_se2() as entry_exit.py, then warps --map into the
--ref-map frame and draws the two on top of each other.

Example:
    python preview_transform.py \
        --map user_map.json --points known_points.txt \
        --ref-map y2e2_aligned.json --ref-points known_points_big.txt
"""

import argparse
import json
import os
import sys

import numpy as np

# Import transform.py directly so the preview doesn't need cyclonedds (pulled in by dds_utils/__init__).
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "dds_utils"))
from transform import estimate_se2, load_known_points  # noqa: E402

RMS_WARN_M = 0.2
OCCUPIED_THRESH = 50


def load_map(path):
    """Load a {'data': {'map': ...}} JSON map into a grid plus its metadata."""
    with open(path, 'r') as f:
        m = json.load(f)['data']['map']
    grid = np.array(m['occupancy'], dtype=np.int16).reshape(m['height'], m['width'])
    qz = m.get('origin_orientation_z', 0) or 0
    qw = m.get('origin_orientation_w', 1)
    qw = 1 if qw is None else qw
    return {
        'grid': grid,
        'res': float(m['resolution']),
        'origin': np.array([m.get('origin_x', 0) or 0, m.get('origin_y', 0) or 0], dtype=float),
        'yaw': 2.0 * np.arctan2(qz, qw),
    }


def _rot(theta):
    c, s = np.cos(theta), np.sin(theta)
    return np.array([[c, -s], [s, c]])


def map_corners(m):
    """World coordinates of the four grid corners."""
    h, w = m['grid'].shape
    local = np.array([[0, 0], [w, 0], [w, h], [0, h]], dtype=float) * m['res']
    return local @ _rot(m['yaw']).T + m['origin']


def sample(m, xy):
    """Nearest-neighbor lookup of world points xy (N, 2); -1 outside the map."""
    local = (xy - m['origin']) @ _rot(m['yaw'])  # R(yaw)^T applied to row vectors
    col = np.floor(local[:, 0] / m['res']).astype(int)
    row = np.floor(local[:, 1] / m['res']).astype(int)
    h, w = m['grid'].shape
    inside = (col >= 0) & (col < w) & (row >= 0) & (row < h)
    out = np.full(len(xy), -1, dtype=np.int16)
    out[inside] = m['grid'][row[inside], col[inside]]
    return out


def to_rgb(grid):
    """Grayscale render: unknown mid-gray, free white, occupied black."""
    img = np.full(grid.shape + (3,), 0.8)
    img[(grid >= 0) & (grid < OCCUPIED_THRESH)] = 1.0
    img[grid >= OCCUPIED_THRESH] = 0.0
    return img


def overlay_rgb(mine, ref):
    """Free space light gray; occupied: ref-only blue, mine-only red, both black."""
    img = np.full(mine.shape + (3,), 0.85)
    img[((mine >= 0) & (mine < OCCUPIED_THRESH)) | ((ref >= 0) & (ref < OCCUPIED_THRESH))] = 0.97
    m_occ = mine >= OCCUPIED_THRESH
    r_occ = ref >= OCCUPIED_THRESH
    img[r_occ & ~m_occ] = (0.15, 0.35, 0.95)
    img[m_occ & ~r_occ] = (0.95, 0.2, 0.2)
    img[m_occ & r_occ] = 0.0
    return img


def extent(m):
    """imshow extent for an axis-aligned map (yaw ignored for the raw panels)."""
    h, w = m['grid'].shape
    x0, y0 = m['origin']
    return [x0, x0 + w * m['res'], y0, y0 + h * m['res']]


def draw_points(ax, pts, marker, color, label_prefix=''):
    for i, (x, y) in enumerate(pts):
        ax.plot(x, y, marker, color=color, markersize=10, markeredgewidth=2, fillstyle='none')
        ax.annotate(f'{label_prefix}{i + 1}', (x, y), xytext=(6, 6), textcoords='offset points',
                    color=color, fontsize=10, fontweight='bold')


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--map', required=True, help='map JSON to transform (this agent)')
    parser.add_argument('--points', required=True, help='known points in --map frame')
    parser.add_argument('--ref-map', required=True, help='reference map JSON')
    parser.add_argument('--ref-points', required=True, help='known points in --ref-map frame')
    parser.add_argument('--save', help='write the figure to this path instead of showing it')
    args = parser.parse_args()

    pts = np.array(load_known_points(args.points))
    ref_pts = np.array(load_known_points(args.ref_points))
    R, t = estimate_se2(pts.tolist(), ref_pts.tolist())
    t = np.asarray(t, dtype=float).reshape(2)
    theta = np.degrees(np.arctan2(R[1, 0], R[0, 0]))

    pts_in_ref = pts @ R.T + t
    residuals = np.linalg.norm(pts_in_ref - ref_pts, axis=1)
    rms = float(np.sqrt(np.mean(residuals ** 2)))

    print(f'theta = {theta:.3f} deg')
    print(f't     = ({t[0]:.4f}, {t[1]:.4f}) m')
    print(f'R     = {R.tolist()}')
    for i, r in enumerate(residuals):
        print(f'  point {i + 1}: residual {r:.3f} m')
    print(f'RMS   = {rms:.3f} m')
    if rms > RMS_WARN_M:
        print(f'WARNING: RMS above {RMS_WARN_M} m - check point correspondences/order')
    sv = np.linalg.svd(pts - pts.mean(axis=0), compute_uv=False)
    if len(sv) < 2 or sv[1] < 0.05 * sv[0]:
        print('WARNING: known points are nearly collinear - rotation is poorly constrained')

    mine = load_map(args.map)
    ref = load_map(args.ref_map)

    # Overlay canvas in the reference frame covering both maps.
    corners = np.vstack([map_corners(ref), map_corners(mine) @ R.T + t])
    xmin, ymin = corners.min(axis=0)
    xmax, ymax = corners.max(axis=0)
    res = ref['res']
    xs = np.arange(xmin, xmax, res) + res / 2
    ys = np.arange(ymin, ymax, res) + res / 2
    gx, gy = np.meshgrid(xs, ys)
    q = np.column_stack([gx.ravel(), gy.ravel()])
    p = (q - t) @ R  # R^T (q - t) for row vectors
    mine_warped = sample(mine, p).reshape(gx.shape)
    ref_on_canvas = sample(ref, q).reshape(gx.shape)

    if args.save:
        import matplotlib
        matplotlib.use('Agg')
    import matplotlib.pyplot as plt

    fig, axes = plt.subplots(1, 3, figsize=(20, 7))

    ax = axes[0]
    ax.imshow(to_rgb(mine['grid']), origin='lower', extent=extent(mine), interpolation='nearest')
    draw_points(ax, pts, 'x', 'red')
    ax.set_title(f'Map: {args.map}')

    ax = axes[1]
    ax.imshow(to_rgb(ref['grid']), origin='lower', extent=extent(ref), interpolation='nearest')
    draw_points(ax, ref_pts, 'o', 'blue')
    ax.set_title(f'Reference: {args.ref_map}')

    ax = axes[2]
    ax.imshow(overlay_rgb(mine_warped, ref_on_canvas), origin='lower',
              extent=[xmin, xmin + len(xs) * res, ymin, ymin + len(ys) * res], interpolation='nearest')
    for a, b in zip(pts_in_ref, ref_pts):
        ax.plot([a[0], b[0]], [a[1], b[1]], '-', color='orange', linewidth=1.5)
    draw_points(ax, ref_pts, 'o', 'blue')
    draw_points(ax, pts_in_ref, 'x', 'red')
    ax.set_title(f'Overlay (ref frame)  θ={theta:.2f}°  t=({t[0]:.2f}, {t[1]:.2f})  RMS={rms:.3f} m\n'
                 'blue = ref only, red = map only, black = both')

    for ax in axes:
        ax.set_xlabel('x [m]')
        ax.set_ylabel('y [m]')
        ax.set_aspect('equal')

    fig.tight_layout()
    if args.save:
        fig.savefig(args.save, dpi=150)
        print(f'saved {args.save}')
    else:
        plt.show()


if __name__ == '__main__':
    main()
