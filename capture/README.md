# Robot capture ingest (central machine)

Standalone service for receiving image and wakeword audio capture sessions from robots (`mattbot_capture`) and storing metadata in PostgreSQL. Separate from the DDS stack in the repo root.

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
/data/captures/robot_2/2025-06-18/{session_id}/frame_*.jpg      # image sessions
/data/captures/robot_2/2025-06-24/{session_id}/utterance.wav      # wakeword sessions
```

## Environment

| Variable | Default | Description |
|----------|---------|-------------|
| `POSTGRES_PASSWORD` | `changeme` | Postgres password (ingest `DATABASE_URL` is built from this in compose) |
| `STORAGE_ROOT` | `/data/captures` | JPEG/WAV + manifest storage |
| `API_KEYS` | empty | Comma-separated keys; when set, `X-Api-Key` required on all routes except `/health` |
| `CAPTURE_DATA_DIR` | `./data/captures` | Host path bind-mounted into ingest container (compose only) |

## API

### Robot upload

**`GET /health`** — no auth. Returns `{"status": "ok"}`.

**`POST /api/v1/upload`** — multipart form:

- Header `X-Robot-Id` (required)
- Header `X-Api-Key` (optional unless `API_KEYS` is set)
- Part `manifest` — JSON file
- Part `files` — one or more binaries; each filename must match `frames[].filename`

Accepted file types (by extension): `.jpg`, `.jpeg`, `.wav`. MIME types on parts are optional (robot may send `image/jpeg` or `audio/wav`).

| Session type | `trigger` | Typical files |
|--------------|-----------|---------------|
| Image | `navigation`, `person`, etc. | `frame_*.jpg` |
| Wakeword audio | `wakeword` | `utterance.wav` |

Wakeword metadata lives in `frames[].extra` (`content_type`, `transcript`, `sample_rate`, `channels`).

Returns `201`:

```json
{"ok": true, "session_id": "...", "files_accepted": 12, "storage_path": "robot_2/2025-06-18/..."}
```

Errors: `400` bad manifest or unsupported file type, `401` auth, `409` file mismatch, `507` disk full.

### Read API (operator / future GUI)

| Method | Path |
|--------|------|
| `GET` | `/api/v1/robots` |
| `GET` | `/api/v1/sessions?robot_id=&trigger=&limit=` |
| `GET` | `/api/v1/sessions/{session_id}/captures` |
| `GET` | `/api/v1/files/{storage_path}` |

Filter wakeword sessions:

```bash
curl -s "http://127.0.0.1:8080/api/v1/sessions?trigger=wakeword"
```

Captures include full `extra` JSON (e.g. `transcript`). Files are served with correct `Content-Type` (`image/jpeg` or `audio/wav`).

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

## Production (NAS)

1. Bind mount large disk: set `CAPTURE_DATA_DIR=/data/captures` in `.env` (or edit compose volume).
2. Set strong `POSTGRES_PASSWORD` and `API_KEYS`.
3. Set each robot's `~ingest_url` and `~api_key` to match.
4. `docker compose up -d` on boot (systemd or cron).

## Stop

```bash
docker compose down
```

To remove the database volume as well: `docker compose down -v`.
