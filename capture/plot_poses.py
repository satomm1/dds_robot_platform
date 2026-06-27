#!/usr/bin/env python3
"""Plot pose trajectory for one pose chunk and save a PNG.

Reads from an archived chunk directory, a SQLite file, or Postgres.

Examples:
  python plot_poses.py --chunk-dir data/captures/poses/robot_1/2026-06-26/chunk_2026-06-26T23-46-36.310450+00-00
  python plot_poses.py --sqlite /path/to/chunk.sqlite -o trajectory.png

Inside compose (Postgres, no host port needed):
  docker compose run --rm ingest python plot_poses.py \\
    --robot-id 1 --chunk-id chunk_2026-06-26T23-46-36.310450+00-00 -o /data/captures/preview.png
"""

from __future__ import annotations

import argparse
import asyncio
import json
import math
import os
import sqlite3
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt


@dataclass(frozen=True)
class PoseRow:
    x: float | None
    y: float | None
    theta: float | None
    valid: bool


@dataclass(frozen=True)
class ChunkInfo:
    robot_id: int | None
    chunk_id: str | None
    started_at: str | None
    ended_at: str | None
    row_count: int | None


def load_meta(chunk_dir: Path) -> ChunkInfo:
    meta_path = chunk_dir / "meta.json"
    if not meta_path.is_file():
        return ChunkInfo(None, chunk_dir.name, None, None, None)
    data = json.loads(meta_path.read_text(encoding="utf-8"))
    return ChunkInfo(
        robot_id=data.get("robot_id"),
        chunk_id=data.get("chunk_id"),
        started_at=data.get("started_at"),
        ended_at=data.get("ended_at"),
        row_count=data.get("row_count"),
    )


def read_poses_sqlite(sqlite_path: Path) -> list[PoseRow]:
    if not sqlite_path.is_file():
        raise SystemExit(f"SQLite file not found: {sqlite_path}")

    # Copy to a temp file so read-only bind mounts do not trip SQLite journaling.
    data = sqlite_path.read_bytes()
    with tempfile.NamedTemporaryFile(suffix=".sqlite") as tmp:
        tmp.write(data)
        tmp.flush()
        conn = sqlite3.connect(f"file:{tmp.name}?mode=ro", uri=True)
        try:
            rows = conn.execute(
                """
                SELECT x, y, theta, valid
                FROM poses
                ORDER BY wall_time
                """
            ).fetchall()
        except sqlite3.Error as exc:
            raise SystemExit(f"failed to read poses table: {exc}") from exc
        finally:
            conn.close()

    return [
        PoseRow(x=row[0], y=row[1], theta=row[2], valid=bool(row[3]))
        for row in rows
    ]


async def read_poses_postgres(
    database_url: str, robot_id: int, chunk_id: str
) -> list[PoseRow]:
    try:
        import asyncpg
    except ImportError as exc:
        raise SystemExit("asyncpg required for Postgres; use --chunk-dir instead") from exc

    conn = await asyncpg.connect(database_url)
    try:
        records = await conn.fetch(
            """
            SELECT x, y, theta, valid
            FROM robot_poses
            WHERE robot_id = $1 AND chunk_id = $2
            ORDER BY wall_time
            """,
            robot_id,
            chunk_id,
        )
    finally:
        await conn.close()

    if not records:
        raise SystemExit(
            f"no poses for robot_id={robot_id} chunk_id={chunk_id!r}"
        )

    return [
        PoseRow(x=r["x"], y=r["y"], theta=r["theta"], valid=r["valid"])
        for r in records
    ]


def plot_poses(
    poses: list[PoseRow],
    output: Path,
    info: ChunkInfo,
) -> None:
    if not poses:
        raise SystemExit("no pose rows to plot")

    valid_pts = [p for p in poses if p.valid and p.x is not None and p.y is not None]
    invalid_pts = [p for p in poses if not p.valid and p.x is not None and p.y is not None]

    fig, ax = plt.subplots(figsize=(10, 10))

    if valid_pts:
        xs = [p.x for p in valid_pts]
        ys = [p.y for p in valid_pts]
        ax.plot(xs, ys, "-", color="#2563eb", linewidth=1.5, alpha=0.8, label="valid")
        ax.scatter(xs, ys, s=8, color="#2563eb", alpha=0.5, zorder=3)
        ax.scatter([xs[0]], [ys[0]], s=120, marker="o", color="#16a34a", zorder=4, label="start")
        ax.scatter([xs[-1]], [ys[-1]], s=120, marker="s", color="#dc2626", zorder=4, label="end")

        step = max(1, len(valid_pts) // 15)
        for p in valid_pts[::step]:
            if p.theta is None:
                continue
            ax.arrow(
                p.x,
                p.y,
                0.25 * math.cos(p.theta),
                0.25 * math.sin(p.theta),
                head_width=0.08,
                head_length=0.08,
                fc="#1e40af",
                ec="#1e40af",
                alpha=0.7,
                length_includes_head=True,
            )

    if invalid_pts:
        ax.scatter(
            [p.x for p in invalid_pts],
            [p.y for p in invalid_pts],
            s=30,
            marker="x",
            color="#f97316",
            label="invalid TF",
            zorder=3,
        )

    ax.set_aspect("equal", adjustable="box")
    ax.set_xlabel("x (m)")
    ax.set_ylabel("y (m)")
    ax.grid(True, alpha=0.3)
    ax.legend(loc="best")

    title_parts = []
    if info.chunk_id:
        title_parts.append(info.chunk_id)
    if info.robot_id is not None:
        title_parts.append(f"robot {info.robot_id}")
    ax.set_title(" — ".join(title_parts) if title_parts else "Pose trajectory")

    valid_n = sum(1 for p in poses if p.valid)
    invalid_n = len(poses) - valid_n
    subtitle = f"{len(poses)} rows ({valid_n} valid, {invalid_n} invalid)"
    if info.started_at and info.ended_at:
        subtitle += f"\n{info.started_at} → {info.ended_at}"
    if info.row_count is not None and info.row_count != len(poses):
        subtitle += f"\nmeta row_count={info.row_count} (actual {len(poses)})"
    ax.text(0.02, 0.02, subtitle, transform=ax.transAxes, fontsize=9, va="bottom")

    output.parent.mkdir(parents=True, exist_ok=True)
    fig.tight_layout()
    fig.savefig(output, dpi=150)
    plt.close(fig)
    print(f"Wrote {output} ({len(poses)} poses, {valid_n} valid)")


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    src = parser.add_mutually_exclusive_group(required=True)
    src.add_argument(
        "--chunk-dir",
        type=Path,
        help="Archive directory containing chunk.sqlite and optional meta.json",
    )
    src.add_argument("--sqlite", type=Path, help="Path to chunk.sqlite")
    src.add_argument(
        "--robot-id",
        type=int,
        help="Robot id (with --chunk-id and DATABASE_URL) for Postgres load",
    )
    parser.add_argument(
        "--chunk-id",
        help="Chunk id (with --robot-id) for Postgres load",
    )
    parser.add_argument(
        "-o",
        "--output",
        type=Path,
        default=Path("poses.png"),
        help="Output PNG path (default: poses.png)",
    )
    parser.add_argument(
        "--database-url",
        default=os.environ.get("DATABASE_URL"),
        help="Postgres URL (default: DATABASE_URL env)",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> None:
    args = parse_args(argv or sys.argv[1:])

    if args.chunk_dir:
        chunk_dir = args.chunk_dir.resolve()
        sqlite_path = chunk_dir / "chunk.sqlite"
        info = load_meta(chunk_dir)
        poses = read_poses_sqlite(sqlite_path)
    elif args.sqlite:
        sqlite_path = args.sqlite.resolve()
        info = ChunkInfo(None, sqlite_path.stem, None, None, None)
        poses = read_poses_sqlite(sqlite_path)
    else:
        if args.robot_id is None or not args.chunk_id:
            raise SystemExit("--robot-id and --chunk-id required for Postgres load")
        if not args.database_url:
            raise SystemExit("DATABASE_URL or --database-url required for Postgres load")
        info = ChunkInfo(args.robot_id, args.chunk_id, None, None, None)
        poses = asyncio.run(
            read_poses_postgres(args.database_url, args.robot_id, args.chunk_id)
        )

    plot_poses(poses, args.output.resolve(), info)


if __name__ == "__main__":
    main()
