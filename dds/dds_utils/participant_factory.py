from cyclonedds.domain import DomainParticipant, DomainParticipantQos
from cyclonedds.util import duration

from .config import PARTICIPANT_LEASE_DURATION_MS


def make_domain_participant_with_lease():
    lease_duration_ms = PARTICIPANT_LEASE_DURATION_MS
    qos_profile = DomainParticipantQos()
    qos_profile.lease_duration = duration(milliseconds=lease_duration_ms)
    return DomainParticipant(qos=qos_profile)
