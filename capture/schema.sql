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
CREATE INDEX idx_captures_extra_modality ON captures ((extra->>'modality'));

CREATE TABLE robot_poses (
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

CREATE INDEX idx_robot_poses_robot_time ON robot_poses (robot_id, wall_time);

CREATE TABLE detection_snapshots (
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

CREATE INDEX idx_detection_snapshots_robot_time
  ON detection_snapshots (robot_id, wall_time);
CREATE INDEX idx_detection_objects
  ON detection_snapshots USING GIN (objects);
