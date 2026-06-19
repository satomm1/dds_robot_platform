CREATE TABLE robots (
  id          INTEGER PRIMARY KEY,
  name        TEXT,
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE sessions (
  id           UUID PRIMARY KEY,
  robot_id     INTEGER NOT NULL REFERENCES robots(id),
  trigger      TEXT NOT NULL,
  started_at   TIMESTAMPTZ NOT NULL,
  ended_at     TIMESTAMPTZ,
  status       TEXT NOT NULL DEFAULT 'complete',
  frame_count  INTEGER NOT NULL DEFAULT 0,
  storage_path TEXT NOT NULL,
  uploaded_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE captures (
  id            BIGSERIAL PRIMARY KEY,
  session_id    UUID NOT NULL REFERENCES sessions(id),
  robot_id      INTEGER NOT NULL REFERENCES robots(id),
  frame_id      TEXT NOT NULL,
  filename      TEXT NOT NULL,
  storage_path  TEXT NOT NULL,
  ros_time_sec  BIGINT NOT NULL,
  ros_time_nsec INTEGER NOT NULL,
  wall_time     TIMESTAMPTZ,
  pose_x        DOUBLE PRECISION,
  pose_y        DOUBLE PRECISION,
  pose_theta    DOUBLE PRECISION,
  detections    JSONB DEFAULT '[]',
  extra         JSONB DEFAULT '{}',
  sha256        TEXT,
  UNIQUE (session_id, frame_id)
);

CREATE INDEX idx_captures_robot_time ON captures (robot_id, wall_time);
CREATE INDEX idx_captures_detections ON captures USING GIN (detections);
