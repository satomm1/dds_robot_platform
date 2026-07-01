# Robot capture ingest (central machine)

Standalone service for receiving image (RGB + IR + depth), wakeword audio, pose trajectory, and object detection data from robots (`mattbot_capture`) and storing metadata in PostgreSQL. Separate from the DDS stack in the repo root.

Robots POST completed sessions here; they never connect to the database directly.

## Quick start (dev)

Uses **`ghcr.io/satomm1/matt_python:1.1.0`** (same image as the root GraphQL stack; includes `asyncpg`).

```bash
cd capture
cp .env.example .env
docker compose pull
docker compose up -d
curl -s http://127.0.0.1:8080/health
# {"status":"ok"}
```

Point each robot's uploader at:

```
http://<central-ip>:8080/api/v1/upload
```

Example from robot bringup:

```bash
roslaunch mattbot_bringup short.launch capture:=true \
  capture_ingest_url:=http://192.168.50.2:8080/api/v1/upload
```

Wakeword audio on the robot (for reference):

```bash
roslaunch mattbot_bringup tall.launch capture:=true save_wakeword_audio:=true
```

## Layout

```
capture/
├── server.py       # FastAPI app (upload + read API)
├── schema.sql      # Postgres tables
├── compose.yaml    # postgres + ingest (uses ghcr.io/satomm1/matt_python:1.1.0)
└── .env.example
```

Files land on disk at `STORAGE_ROOT` (default `/data/captures`):

```
/data/captures/robot_2/2025-06-18/{session_id}/manifest.json
/data/captures/robot_2/2025-06-18/{session_id}/frame_*.jpg          # RGB image sessions
/data/captures/robot_2/2025-06-18/{session_id}/frame_*_ir.jpg       # IR companion (Astra Pro Plus)
/data/captures/robot_2/2025-06-18/{session_id}/frame_*_depth.png   # depth companion (16-bit mm PNG)
/data/captures/robot_2/2025-06-24/{session_id}/utterance.wav         # wakeword sessions
/data/captures/poses/robot_2/2025-06-26/chunk_2025-06-26T14-00-00Z/  # pose chunk archives
/data/captures/detections/robot_2/2025-06-26/chunk_2025-06-26T14-00-00Z/  # detection chunk archives
```

On Astra Pro Plus robots with `capture:=true`, expect up to **3 files per capture tick** (RGB + IR + depth) when depth is enabled, or ~2× (RGB + IR) without depth. `sessions.frame_count` is the total file count (includes IR and depth rows), not the number of capture events.

With `capture:=true`, robots also run `pose_uploader` and `detection_uploader`, which POST hourly SQLite chunks to `/api/v1/pose_upload` and `/api/v1/detection_upload` (~24 chunks/robot/day each). At default ~1 Hz, expect ~3,600 detection rows/hour/robot. Pose and detection rows join to image captures on `(robot_id, wall_time)`.

## Environment

| Variable | Default | Description |
|----------|---------|-------------|
| `POSTGRES_PASSWORD` | `changeme` | Postgres password (ingest `DATABASE_URL` is built from this in compose) |
| `STORAGE_ROOT` | `/data/captures` | JPEG/PNG/WAV + manifest + pose archive storage |
| `API_KEYS` | empty | Comma-separated keys; when set, `X-Api-Key` required on all routes except `/health` |
| `POSE_ARCHIVE` | `true` | When true, store uploaded pose `.sqlite` + meta under `STORAGE_ROOT/poses/` |
| `DETECTION_ARCHIVE` | `true` | When true, store uploaded detection `.sqlite` + meta under `STORAGE_ROOT/detections/` |
| `CAPTURE_DATA_DIR` | `./data/captures` | Host path bind-mounted into ingest container (compose only) |

## API

### Robot upload

**`GET /health`** — no auth. Returns `{"status": "ok"}`.

**`POST /api/v1/upload`** — multipart form:

- Header `X-Robot-Id` (required)
- Header `X-Api-Key` (optional unless `API_KEYS` is set)
- Part `manifest` — JSON file
- Part `files` — one or more binaries; each filename must match `frames[].filename`

Accepted file types (by extension): `.jpg`, `.jpeg`, `.png`, `.wav`. MIME types on parts are optional (robot may send `image/jpeg`, `image/png`, or `audio/wav`).

| Session type | `trigger` | Typical files |
|--------------|-----------|---------------|
| Image (RGB) | `navigation`, `person`, etc. | `frame_*.jpg` |
| Image (IR companion) | same session as RGB | `frame_*_ir.jpg` |
| Image (depth companion) | same session as RGB | `frame_*_depth.png` |
| Wakeword audio | `wakeword` | `utterance.wav` |

IR frames are identified by `frames[].extra.modality == "ir"` or filename `*_ir.jpg`. Depth frames use `extra.modality == "depth"` or `*_depth.png`. IR and depth link to RGB via `extra.rgb_frame_id`. Companion rows have `pose: null` and empty `detections`; metadata stays in `extra` JSONB.

Depth PNG files are **16-bit grayscale, millimeters (16UC1)**. Ingest stores and serves raw bytes; consumers must decode as `uint16`, not as a normal 8-bit RGB image:

```python
import numpy as np
from PIL import Image

depth_mm = np.array(Image.open(path), dtype=np.uint16)
```

Wakeword metadata lives in `frames[].extra` (`content_type`, `transcript`, `sample_rate`, `channels`).

Returns `201`:

```json
{"ok": true, "session_id": "...", "files_accepted": 12, "storage_path": "robot_2/2025-06-18/..."}
```

Errors: `400` bad manifest or unsupported file type, `401` auth, `409` file mismatch, `507` disk full.

### Pose upload

**`POST /api/v1/pose_upload`** — multipart form (used by `pose_uploader` when `capture:=true`):

- Header `X-Robot-Id` (required)
- Header `X-Api-Key` (optional unless `API_KEYS` is set)
- Part `meta` — JSON file (`chunk_*.meta.json`)
- Part `chunk` — SQLite file (`chunk_*.sqlite`)

Meta must include `schema_version: 1`, `status: "ready_for_upload"`, `robot_id`, `chunk_id`, `started_at`, `ended_at`, `row_count`. The SQLite file must contain a `poses` table. Rows with `valid=0` (failed TF lookup) are stored intentionally.

Returns `201`:

```json
{"ok": true, "chunk_id": "chunk_2025-06-26T14-00-00Z", "rows_accepted": 7200}
```

`rows_accepted` is the number of new rows inserted (0 on idempotent retry). Robot treats HTTP 200 or 201 as success.

Errors: `400` bad meta or invalid SQLite, `401` auth, `409` row_count mismatch, `507` disk full (archival).

Query trajectory (via Postgres):

```sql
SELECT wall_time, x, y, theta FROM robot_poses
WHERE robot_id = 2 ORDER BY wall_time;
```

### Detection upload

**`POST /api/v1/detection_upload`** — multipart form (used by `detection_uploader` when `capture:=true`):

- Header `X-Robot-Id` (required)
- Header `X-Api-Key` (optional unless `API_KEYS` is set)
- Part `meta` — JSON file (`chunk_*.meta.json`)
- Part `chunk` — SQLite file (`chunk_*.sqlite`)

Meta must include `schema_version: 1`, `status: "ready_for_upload"`, `robot_id`, `chunk_id`, `started_at`, `ended_at`, `row_count`. The SQLite file must contain a `detection_snapshots` table with `objects_json` (JSON array string per row). Rows with `object_count=0` and `objects_json='[]'` are normal. When `robot_valid=0`, robot pose columns may be NULL but object map poses in `objects[].pose` may still be valid.

Returns `201`:

```json
{"ok": true, "chunk_id": "chunk_2025-06-26T14-00-00Z", "rows_accepted": 3600}
```

`rows_accepted` is the number of new rows inserted (0 on idempotent retry). Idempotency key: `(robot_id, wall_time, chunk_id)`.

Errors: `400` bad meta or invalid SQLite/JSON, `401` auth, `409` row_count mismatch, `507` disk full (archival).

Query detections (via Postgres — no read API in v1):

```sql
-- all persons in a time window
SELECT wall_time, obj
FROM detection_snapshots d,
     jsonb_array_elements(d.objects) obj
WHERE d.robot_id = 2
  AND d.wall_time >= '2025-06-26T14:00:00Z'
  AND obj->>'class_name' = 'person';

-- snapshots with any detections
SELECT * FROM detection_snapshots
WHERE robot_id = 2 AND object_count > 0;

-- nearest detection snapshot to an image capture frame
SELECT d.*
FROM detection_snapshots d
WHERE d.robot_id = 2
  AND d.wall_time BETWEEN $frame_wall_time - interval '1 second'
                      AND $frame_wall_time + interval '1 second'
ORDER BY abs(extract(epoch from (d.wall_time - $frame_wall_time::timestamptz)))
LIMIT 1;

-- join to robot pose stream on wall_time
SELECT d.wall_time, d.object_count, p.x, p.y, p.theta
FROM detection_snapshots d
JOIN robot_poses p ON p.robot_id = d.robot_id AND p.wall_time = d.wall_time
WHERE d.robot_id = 2;
```

Object poses in `objects[].pose.x/y` are already in map frame (meters). Same schema as image capture `frames[].detections[]`. For programmatic access, use `GET /api/v1/robots/{robot_id}/detections` (see Read API below) instead of raw SQL.

### Read API (operator / future GUI)

| Method | Path |
|--------|------|
| `GET` | `/api/v1/robots` |
| `GET` | `/api/v1/robots/{robot_id}/poses?from=&to=&limit=` |
| `GET` | `/api/v1/robots/{robot_id}/detections?from=&to=&limit=&min_object_count=` |
| `GET` | `/api/v1/robots/{robot_id}/capture_events?from=&to=&limit=&exclude_trigger=` |
| `GET` | `/api/v1/sessions?robot_id=&trigger=&from=&to=&limit=` |
| `GET` | `/api/v1/sessions/{session_id}/captures?modality=all\|rgb\|ir\|depth` |
| `GET` | `/api/v1/sessions/{session_id}/pairs` |
| `GET` | `/api/v1/files/{storage_path}` |

Time-range endpoints use a half-open interval **`[from, to)`** (ISO 8601). Default `limit` is 5000 (max 20000). Results are ordered by `wall_time` ascending.

**Robot poses** — continuous trajectory for map replay:

```bash
curl -s "http://127.0.0.1:8080/api/v1/robots/2/poses?from=2025-06-26T14:00:00Z&to=2025-06-26T15:00:00Z"
```

**Detection snapshots** — object detections in map frame (`min_object_count` defaults to 0):

```bash
curl -s "http://127.0.0.1:8080/api/v1/robots/2/detections?from=2025-06-26T14:00:00Z&to=2025-06-26T15:00:00Z&min_object_count=1"
```

**Capture events** — RGB/IR/depth groups across all image sessions in a window (excludes `wakeword` by default via `exclude_trigger`):

```bash
curl -s "http://127.0.0.1:8080/api/v1/robots/2/capture_events?from=2025-06-24T00:00:00Z&to=2025-06-25T00:00:00Z"
```

**Replay client recipe** (map + conditional camera panel):

1. `GET .../poses?from=&to=` — scrub robot position and trail
2. `GET .../detections?from=&to=` — object markers at scrub time (binary-search by `wall_time`)
3. `GET .../capture_events?from=&to=` — timeline markers; show images when scrub time is within ~1s of an event `wall_time`
4. `GET .../files/{storage_path}` — image bytes from event `rgb` / `ir` / `depth` `storage_path`

Session-scoped review (single upload) still uses `/sessions/{session_id}/pairs` instead of `capture_events`.

Filter sessions by `started_at` window (`from` and `to` must be set together):

```bash
curl -s "http://127.0.0.1:8080/api/v1/sessions?robot_id=2&from=2025-06-24T00:00:00Z&to=2025-06-25T00:00:00Z"
```

Filter wakeword sessions:

```bash
curl -s "http://127.0.0.1:8080/api/v1/sessions?trigger=wakeword"
```

RGB-only capture list (exclude IR and depth companions):

```bash
curl -s "http://127.0.0.1:8080/api/v1/sessions/{session_id}/captures?modality=rgb"
```

Depth-only list:

```bash
curl -s "http://127.0.0.1:8080/api/v1/sessions/{session_id}/captures?modality=depth"
```

RGB + IR + depth groups for side-by-side display (`/pairs` returns `{rgb, ir, depth}` per capture tick; missing companions are `null`):

```bash
curl -s "http://127.0.0.1:8080/api/v1/sessions/{session_id}/pairs"
```

Captures include full `extra` JSON (e.g. `transcript`). Files are served with correct `Content-Type` (`image/jpeg`, `image/png`, or `audio/wav`).

## Manual upload test (image)

```bash
SESSION_ID=$(python3 -c 'import uuid; print(uuid.uuid4())')

cat > /tmp/manifest.json <<EOF
{
  "schema_version": 1,
  "status": "ready_for_upload",
  "robot_id": 2,
  "session_id": "$SESSION_ID",
  "trigger": "test",
  "started_at": "2025-06-18T10:00:00Z",
  "frames": [
    {
      "frame_id": "f1",
      "filename": "frame_1_0.jpg",
      "ros_time_sec": 1,
      "ros_time_nsec": 0,
      "wall_time": "2025-06-18T10:00:01Z",
      "pose": {"x": 1.0, "y": 2.0, "theta": 0.5},
      "detections": [],
      "extra": {}
    }
  ]
}
EOF

echo 'fake jpeg' > /tmp/frame_1_0.jpg

curl -s -X POST http://127.0.0.1:8080/api/v1/upload \
  -H "X-Robot-Id: 2" \
  -F "manifest=@/tmp/manifest.json;type=application/json" \
  -F "files=@/tmp/frame_1_0.jpg;type=image/jpeg"

curl -s "http://127.0.0.1:8080/api/v1/sessions?robot_id=2"
curl -s "http://127.0.0.1:8080/api/v1/sessions/$SESSION_ID/captures"
```

## Manual upload test (RGB + IR pair)

```bash
SESSION_ID=$(python3 -c 'import uuid; print(uuid.uuid4())')

cat > /tmp/rgb_ir_manifest.json <<EOF
{
  "schema_version": 1,
  "status": "ready_for_upload",
  "robot_id": 2,
  "session_id": "$SESSION_ID",
  "trigger": "navigation",
  "started_at": "2025-06-24T12:00:00Z",
  "frames": [
    {
      "frame_id": "frame_100_200",
      "filename": "frame_100_200.jpg",
      "ros_time": {"sec": 100, "nsec": 200},
      "wall_time": "2025-06-24T12:00:00Z",
      "pose": {"x": 1.2, "y": 3.4, "theta": 0.5},
      "detections": [{"class_name": "person", "probability": 0.92}],
      "extra": {}
    },
    {
      "frame_id": "frame_100_200_ir",
      "filename": "frame_100_200_ir.jpg",
      "ros_time": {"sec": 100, "nsec": 200},
      "wall_time": "2025-06-24T12:00:01Z",
      "pose": null,
      "detections": [],
      "extra": {
        "modality": "ir",
        "content_type": "image/jpeg",
        "rgb_frame_id": "frame_100_200"
      }
    }
  ]
}
EOF

echo 'fake rgb jpeg' > /tmp/frame_100_200.jpg
echo 'fake ir jpeg' > /tmp/frame_100_200_ir.jpg

curl -s -X POST http://127.0.0.1:8080/api/v1/upload \
  -H "X-Robot-Id: 2" \
  -F "manifest=@/tmp/rgb_ir_manifest.json;type=application/json" \
  -F "files=@/tmp/frame_100_200.jpg;type=image/jpeg" \
  -F "files=@/tmp/frame_100_200_ir.jpg;type=image/jpeg"

curl -s "http://127.0.0.1:8080/api/v1/sessions/$SESSION_ID/captures"
curl -s "http://127.0.0.1:8080/api/v1/sessions/$SESSION_ID/captures?modality=rgb"
curl -s "http://127.0.0.1:8080/api/v1/sessions/$SESSION_ID/captures?modality=ir"
curl -s "http://127.0.0.1:8080/api/v1/sessions/$SESSION_ID/pairs"
```

## Manual upload test (RGB + IR + depth)

```bash
SESSION_ID=$(python3 -c 'import uuid; print(uuid.uuid4())')

cat > /tmp/rgb_ir_depth_manifest.json <<EOF
{
  "schema_version": 1,
  "status": "ready_for_upload",
  "robot_id": 2,
  "session_id": "$SESSION_ID",
  "trigger": "navigation",
  "started_at": "2025-06-24T12:00:00Z",
  "frames": [
    {
      "frame_id": "frame_100_200",
      "filename": "frame_100_200.jpg",
      "ros_time": {"sec": 100, "nsec": 200},
      "wall_time": "2025-06-24T12:00:00Z",
      "pose": {"x": 1.2, "y": 3.4, "theta": 0.5},
      "detections": [{"class_name": "person", "probability": 0.92}],
      "extra": {}
    },
    {
      "frame_id": "frame_100_200_ir",
      "filename": "frame_100_200_ir.jpg",
      "ros_time": {"sec": 100, "nsec": 200},
      "wall_time": "2025-06-24T12:00:01Z",
      "pose": null,
      "detections": [],
      "extra": {
        "modality": "ir",
        "content_type": "image/jpeg",
        "rgb_frame_id": "frame_100_200"
      }
    },
    {
      "frame_id": "frame_100_200_depth",
      "filename": "frame_100_200_depth.png",
      "ros_time": {"sec": 100, "nsec": 200},
      "wall_time": "2025-06-24T12:00:01Z",
      "pose": null,
      "detections": [],
      "extra": {
        "modality": "depth",
        "content_type": "image/png",
        "rgb_frame_id": "frame_100_200"
      }
    }
  ]
}
EOF

echo 'fake rgb jpeg' > /tmp/frame_100_200.jpg
echo 'fake ir jpeg' > /tmp/frame_100_200_ir.jpg
echo 'fake depth png' > /tmp/frame_100_200_depth.png

curl -s -X POST http://127.0.0.1:8080/api/v1/upload \
  -H "X-Robot-Id: 2" \
  -F "manifest=@/tmp/rgb_ir_depth_manifest.json;type=application/json" \
  -F "files=@/tmp/frame_100_200.jpg;type=image/jpeg" \
  -F "files=@/tmp/frame_100_200_ir.jpg;type=image/jpeg" \
  -F "files=@/tmp/frame_100_200_depth.png;type=image/png"

curl -s "http://127.0.0.1:8080/api/v1/sessions/$SESSION_ID/captures?modality=rgb"
curl -s "http://127.0.0.1:8080/api/v1/sessions/$SESSION_ID/captures?modality=ir"
curl -s "http://127.0.0.1:8080/api/v1/sessions/$SESSION_ID/captures?modality=depth"
curl -s "http://127.0.0.1:8080/api/v1/sessions/$SESSION_ID/pairs"
curl -s -o /dev/null -w "HTTP %{http_code}\n" \
  "http://127.0.0.1:8080/api/v1/files/robot_2/2025-06-24/$SESSION_ID/frame_100_200_depth.png"
```

## Manual upload test (wakeword audio)

```bash
SESSION_ID=$(python3 -c 'import uuid; print(uuid.uuid4())')

python3 - <<'PY'
import wave
import struct
path = "/tmp/utterance.wav"
with wave.open(path, "w") as w:
    w.setnchannels(1)
    w.setsampwidth(2)
    w.setframerate(16000)
    w.writeframes(struct.pack("<h", 0) * 1600)
PY

cat > /tmp/wakeword_manifest.json <<EOF
{
  "schema_version": 1,
  "status": "ready_for_upload",
  "robot_id": 2,
  "session_id": "$SESSION_ID",
  "trigger": "wakeword",
  "started_at": "2025-06-24T15:30:45+00:00",
  "ended_at": "2025-06-24T15:30:45+00:00",
  "frames": [{
    "frame_id": "utterance",
    "filename": "utterance.wav",
    "ros_time": {"sec": 0, "nsec": 0},
    "wall_time": "2025-06-24T15:30:45+00:00",
    "pose": null,
    "detections": [],
    "extra": {
      "content_type": "audio/wav",
      "sample_rate": 16000,
      "channels": 1,
      "transcript": "go to the kitchen"
    }
  }]
}
EOF

curl -s -X POST http://127.0.0.1:8080/api/v1/upload \
  -H "X-Robot-Id: 2" \
  -F "manifest=@/tmp/wakeword_manifest.json;type=application/json" \
  -F "files=@/tmp/utterance.wav;type=audio/wav"

curl -s "http://127.0.0.1:8080/api/v1/sessions?trigger=wakeword"
curl -s "http://127.0.0.1:8080/api/v1/sessions/$SESSION_ID/captures"
curl -s -o /dev/null -w "HTTP %{http_code}\n" \
  "http://127.0.0.1:8080/api/v1/files/robot_2/2025-06-24/$SESSION_ID/utterance.wav"
```

## Manual upload test (pose chunk)

```bash
python3 - <<'PY'
import json
import sqlite3

chunk_path = "/tmp/chunk_2025-06-26T14-00-00Z.sqlite"
meta_path = "/tmp/chunk_2025-06-26T14-00-00Z.meta.json"

conn = sqlite3.connect(chunk_path)
conn.execute("""
CREATE TABLE poses (
  id INTEGER PRIMARY KEY,
  wall_time TEXT NOT NULL,
  ros_time_sec INTEGER,
  ros_time_nsec INTEGER,
  x REAL, y REAL, theta REAL,
  frame TEXT,
  ref_x REAL, ref_y REAL, ref_theta REAL,
  is_static INTEGER NOT NULL,
  valid INTEGER NOT NULL
)
""")
rows = [
    ("2025-06-26T14:00:01+00:00", 100, 0, 1.0, 2.0, 0.5, "map", 10.0, 20.0, 0.1, 0, 1),
    ("2025-06-26T14:00:02+00:00", 100, 500000000, 1.1, 2.1, 0.6, "map", None, None, None, 0, 0),
]
conn.executemany(
    "INSERT INTO poses (wall_time, ros_time_sec, ros_time_nsec, x, y, theta, frame,"
    " ref_x, ref_y, ref_theta, is_static, valid) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
    rows,
)
conn.commit()
conn.close()

meta = {
    "schema_version": 1,
    "robot_id": 2,
    "chunk_id": "chunk_2025-06-26T14-00-00Z",
    "started_at": "2025-06-26T14:00:00+00:00",
    "ended_at": "2025-06-26T15:00:00+00:00",
    "row_count": len(rows),
    "status": "ready_for_upload",
}
with open(meta_path, "w", encoding="utf-8") as f:
    json.dump(meta, f)
PY

curl -s -X POST http://127.0.0.1:8080/api/v1/pose_upload \
  -H "X-Robot-Id: 2" \
  -F "meta=@/tmp/chunk_2025-06-26T14-00-00Z.meta.json;type=application/json" \
  -F "chunk=@/tmp/chunk_2025-06-26T14-00-00Z.sqlite;type=application/x-sqlite3"

# Idempotent retry (expect rows_accepted: 0)
curl -s -X POST http://127.0.0.1:8080/api/v1/pose_upload \
  -H "X-Robot-Id: 2" \
  -F "meta=@/tmp/chunk_2025-06-26T14-00-00Z.meta.json;type=application/json" \
  -F "chunk=@/tmp/chunk_2025-06-26T14-00-00Z.sqlite;type=application/x-sqlite3"
```

Verify in Postgres:

```bash
docker compose exec postgres psql -U capture -d robot_capture -c \
  "SELECT wall_time, x, y, theta, valid FROM robot_poses WHERE robot_id = 2 ORDER BY wall_time;"
```

## Manual upload test (detection chunk)

```bash
python3 - <<'PY'
import json
import sqlite3

chunk_path = "/tmp/detection_chunk_2025-06-26T14-00-00Z.sqlite"
meta_path = "/tmp/detection_chunk_2025-06-26T14-00-00Z.meta.json"

objects_with_person = json.dumps([
    {
        "class_name": "person",
        "probability": 0.92,
        "pose": {"x": 12.3, "y": 4.5, "z": 0.0},
        "width": 0.33,
        "bbox": [120.0, 80.0, 200.0, 300.0],
    }
])

conn = sqlite3.connect(chunk_path)
conn.execute("""
CREATE TABLE detection_snapshots (
  id INTEGER PRIMARY KEY,
  wall_time TEXT NOT NULL,
  ros_time_sec INTEGER,
  ros_time_nsec INTEGER,
  robot_x REAL,
  robot_y REAL,
  robot_theta REAL,
  robot_frame TEXT,
  robot_valid INTEGER NOT NULL,
  object_count INTEGER NOT NULL,
  objects_json TEXT NOT NULL
)
""")
rows = [
    (
        "2025-06-26T14:00:01+00:00", 100, 0,
        10.2, 3.4, 1.57, "map", 1, 1, objects_with_person,
    ),
    (
        "2025-06-26T14:00:02+00:00", 100, 500000000,
        None, None, None, "map", 0, 0, "[]",
    ),
]
conn.executemany(
    "INSERT INTO detection_snapshots (wall_time, ros_time_sec, ros_time_nsec,"
    " robot_x, robot_y, robot_theta, robot_frame, robot_valid, object_count, objects_json)"
    " VALUES (?,?,?,?,?,?,?,?,?,?)",
    rows,
)
conn.commit()
conn.close()

meta = {
    "schema_version": 1,
    "robot_id": 2,
    "chunk_id": "chunk_2025-06-26T14-00-00Z",
    "started_at": "2025-06-26T14:00:00+00:00",
    "ended_at": "2025-06-26T15:00:00+00:00",
    "row_count": len(rows),
    "status": "ready_for_upload",
}
with open(meta_path, "w", encoding="utf-8") as f:
    json.dump(meta, f)
PY

curl -s -X POST http://127.0.0.1:8080/api/v1/detection_upload \
  -H "X-Robot-Id: 2" \
  -F "meta=@/tmp/detection_chunk_2025-06-26T14-00-00Z.meta.json;type=application/json" \
  -F "chunk=@/tmp/detection_chunk_2025-06-26T14-00-00Z.sqlite;type=application/x-sqlite3"

# Idempotent retry (expect rows_accepted: 0)
curl -s -X POST http://127.0.0.1:8080/api/v1/detection_upload \
  -H "X-Robot-Id: 2" \
  -F "meta=@/tmp/detection_chunk_2025-06-26T14-00-00Z.meta.json;type=application/json" \
  -F "chunk=@/tmp/detection_chunk_2025-06-26T14-00-00Z.sqlite;type=application/x-sqlite3"
```

Verify in Postgres:

```bash
docker compose exec postgres psql -U capture -d robot_capture -c \
  "SELECT wall_time, object_count, robot_valid, objects FROM detection_snapshots WHERE robot_id = 2 ORDER BY wall_time;"
```

## Pose trajectory preview

Plot an uploaded chunk as a PNG (valid path, invalid TF points, start/end markers). Uses `plot_poses.py` inside the ingest image (matplotlib included). Replace `robot_1`, date, and `chunk_id` with your archived chunk under `data/captures/poses/`:

```bash
cd capture
docker compose run --rm ingest python plot_poses.py \
  --chunk-dir data/captures/poses/robot_1/2026-06-26/chunk_2026-06-26T23-46-36.310450+00-00 \
  -o data/captures/pose_preview.png
```

Open `data/captures/pose_preview.png` on the host. To load from Postgres instead of the archive:

```bash
docker compose run --rm ingest python plot_poses.py \
  --robot-id 1 \
  --chunk-id chunk_2026-06-26T23-46-36.310450+00-00 \
  -o data/captures/pose_preview.png
```

## Production (NAS)

1. Bind mount large disk: set `CAPTURE_DATA_DIR=/data/captures` in `.env` (or edit compose volume).
2. Set strong `POSTGRES_PASSWORD` and `API_KEYS`.
3. Set each robot's `~ingest_url` and `~api_key` to match.
4. `docker compose up -d` on boot (systemd or cron).

**Existing Postgres volumes** can run these one-time migrations if needed:

```sql
CREATE INDEX IF NOT EXISTS idx_captures_extra_modality ON captures ((extra->>'modality'));

CREATE TABLE IF NOT EXISTS robot_poses (
  id            BIGSERIAL PRIMARY KEY,
  robot_id      INTEGER NOT NULL,
  wall_time     TIMESTAMPTZ NOT NULL,
  ros_time_sec  BIGINT,
  ros_time_nsec INTEGER,
  x             DOUBLE PRECISION,
  y             DOUBLE PRECISION,
  theta         DOUBLE PRECISION,
  frame         TEXT,
  ref_x         DOUBLE PRECISION,
  ref_y         DOUBLE PRECISION,
  ref_theta     DOUBLE PRECISION,
  is_static     BOOLEAN NOT NULL,
  valid         BOOLEAN NOT NULL,
  chunk_id      TEXT,
  uploaded_at   TIMESTAMPTZ DEFAULT now(),
  UNIQUE (robot_id, wall_time)
);
CREATE INDEX IF NOT EXISTS idx_robot_poses_robot_time ON robot_poses (robot_id, wall_time);

CREATE TABLE IF NOT EXISTS detection_snapshots (
  id              BIGSERIAL PRIMARY KEY,
  robot_id        INTEGER NOT NULL,
  chunk_id        TEXT NOT NULL,
  wall_time       TIMESTAMPTZ NOT NULL,
  ros_time_sec    BIGINT,
  ros_time_nsec   INTEGER,
  robot_x         DOUBLE PRECISION,
  robot_y         DOUBLE PRECISION,
  robot_theta     DOUBLE PRECISION,
  robot_frame     TEXT,
  robot_valid     BOOLEAN NOT NULL,
  object_count    INTEGER NOT NULL,
  objects         JSONB NOT NULL,
  uploaded_at     TIMESTAMPTZ DEFAULT now(),
  UNIQUE (robot_id, wall_time, chunk_id)
);
CREATE INDEX IF NOT EXISTS idx_detection_snapshots_robot_time
  ON detection_snapshots (robot_id, wall_time);
CREATE INDEX IF NOT EXISTS idx_detection_objects
  ON detection_snapshots USING GIN (objects);
```

## Stop

```bash
docker compose down
```

To remove the database volume as well: `docker compose down -v`.
