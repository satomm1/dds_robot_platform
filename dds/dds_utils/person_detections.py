"""Helpers for person_detected DDS payloads (batched and legacy)."""


def person_map_object_num(index):
    """Ignite object_num for person index 0, 1, 2, ... → -1, -2, -3, ..."""
    return -(int(index) + 1)


def iter_person_detections(payload, envelope_timestamp=None):
    """Yield (timestamp, person_dict) for each person in a person_detected payload.

    New wire format: {"timestamp": <float>, "objects": [<DetectedObject>, ...]}.
    Legacy format: a single DetectedObject dict (optional top-level timestamp).
    """
    raw_ts = payload.get("timestamp", envelope_timestamp)
    try:
        ts = float(raw_ts) if raw_ts is not None else 0.0
    except (TypeError, ValueError):
        try:
            ts = float(envelope_timestamp) if envelope_timestamp is not None else 0.0
        except (TypeError, ValueError):
            ts = 0.0

    objects = payload.get("objects")
    if isinstance(objects, list):
        for obj in objects:
            if isinstance(obj, dict):
                yield ts, obj
        return

    # Legacy single-object payload
    if "class_name" in payload or "pose" in payload:
        yield ts, payload
