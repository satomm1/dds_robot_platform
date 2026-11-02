"""Staleness rules for detected objects, shared by the objectPositions reader and the writers."""

import os

# Drop detections older than this (Unix seconds); entries without timestamp are kept.
OBJECT_STALE_SEC = float(os.environ.get("OBJECT_STALE_SEC", "15"))
PERSON_OBJECT_STALE_SEC = float(os.environ.get("PERSON_OBJECT_STALE_SEC", "1.0"))


def is_stale(entry, now):
    """True if a stored detection is older than its class's limit."""
    ts = entry.get("timestamp")
    if ts is None:
        return False
    limit = PERSON_OBJECT_STALE_SEC if entry.get("class_name") == "person" else OBJECT_STALE_SEC
    try:
        return now - float(ts) > limit
    except (TypeError, ValueError):
        return False


def drop_stale(objects, now):
    """Copy of an agent's {object_num: entry} dict without stale entries."""
    return {key: entry for key, entry in objects.items() if not is_stale(entry, now)}
