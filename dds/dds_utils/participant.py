"""Single factory for Cyclone DDS DomainParticipant construction."""

from cyclonedds.domain import DomainParticipant

from .network import make_participant_qos


def create_domain_participant(*, domain_qos: bool = False) -> DomainParticipant:
    """
    Create a DomainParticipant with consistent package defaults.

    Args:
        domain_qos: If True, apply lease participant QoS (``make_participant_qos()``).
            If False, use the Cyclone default participant QoS (matches prior bare
            ``DomainParticipant()`` call sites, e.g. the controller data subscriber).
    """
    if domain_qos:
        return DomainParticipant(qos=make_participant_qos())
    return DomainParticipant()
