import os
import socket

from cyclonedds.domain import DomainParticipantQos
from cyclonedds.util import duration

from .config import PARTICIPANT_LEASE_DURATION_MS


class AgentIdError(RuntimeError):
    """AGENT_ID (or ROBOT_ID fallback) is missing, empty, or not a base-10 integer."""


# Alias for parity with mattbot_dds naming
RobotIdError = AgentIdError


def parse_agent_id_int(value) -> int:
    """Parse an agent id value to ``int``; raises ``ValueError`` if invalid."""
    if value is None:
        raise ValueError("agent id is None")
    s = str(value).strip()
    if not s:
        raise ValueError("agent id is empty")
    return int(s)


def _raw_agent_id_from_env():
    """Controller convention is ``AGENT_ID``; ``ROBOT_ID`` is accepted as fallback."""
    return os.environ.get("AGENT_ID") or os.environ.get("ROBOT_ID")


def require_agent_id_int() -> int:
    """
    Read ``AGENT_ID`` or ``ROBOT_ID`` from the environment and return it as ``int``.

    Raises:
        AgentIdError: if unset, whitespace-only, or not a base-10 integer.
    """
    raw = _raw_agent_id_from_env()
    if raw is None or str(raw).strip() == "":
        raise AgentIdError(
            "AGENT_ID (or ROBOT_ID) environment variable must be set to a non-empty integer agent id"
        )
    try:
        return parse_agent_id_int(raw)
    except ValueError as exc:
        raise AgentIdError(f"Agent id must be a base-10 integer, got {raw!r}") from exc


def require_robot_id_int() -> int:
    """Same as :func:`require_agent_id_int` (name matches mattbot_dds)."""
    return require_agent_id_int()


def get_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    s.connect(("8.8.8.8", 80))
    my_ip = s.getsockname()[0]
    s.close()
    return my_ip


def make_participant_qos() -> DomainParticipantQos:
    """Participant QoS with lease duration (used when ``domain_qos`` is True)."""
    qos_profile = DomainParticipantQos()
    qos_profile.lease_duration = duration(milliseconds=PARTICIPANT_LEASE_DURATION_MS)
    return qos_profile
