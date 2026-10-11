"""Object "still there" belief; copied from mattbot_dds src/dds_utils/belief.py (object_belief only).

Stdlib only so tests can import it directly (bypassing dds_utils/__init__).
"""

# Robot defaults (mattbot_dds): hold belief for T1 s after the latest observation, then decay over T2 s.
BELIEF_T1_S = 60.0
BELIEF_T2_S = 120.0


def object_belief(age_s, t1, t2):
    """1 for age <= t1, then linear decay to 0 over t2 seconds."""
    if age_s <= t1:  # includes age < 0
        return 1.0
    if t2 <= 0 or age_s >= t1 + t2:
        return 0.0
    return 1.0 - (age_s - t1) / t2
