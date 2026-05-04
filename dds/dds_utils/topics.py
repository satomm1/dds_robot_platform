ENTRY_EXIT_TOPIC = "EntryExitTopic"
INITIALIZATION_TOPIC = "InitializationTopic"
HEARTBEAT_TOPIC = "HeartbeatTopic"


def data_topic_name(agent_id) -> str:
    return "DataTopic" + str(agent_id)


def location_topic_name(agent_id) -> str:
    return "LocationTopic" + str(agent_id)


def image_topic_name(agent_id) -> str:
    return "ImageTopic" + str(agent_id)
