# Keep in sync with mattbot_dds src/dds_utils/messages.py (fleet coordination).

MSG_GOAL = "goal"
MSG_MULTI_ROBOT_GOAL = "multi_robot_goal"
MSG_POSITION_INIT = "position_init"
MSG_STOP = "stop"
MSG_ROBOT_SHUTDOWN = "robot_shutdown"
MSG_AIR_QUALITY = "air_quality"

# Observation ledger (DataMessage.data is JSON; see dds_utils/ledger.py and observation_ledger.py).
MSG_LEDGER_OBSERVATION = "ledger_observation"  # sender's own DataTopic; Observation.to_dict()
MSG_LEDGER_REMOVAL = "ledger_removal"  # sender's own DataTopic; Removal.to_dict()
MSG_LEDGER_SYNC_REQUEST = "ledger_sync_request"  # sender's own DataTopic; {"requester", "responders", "agents"}
MSG_LEDGER_SYNC_RESPONSE = "ledger_sync_response"  # DataTopic{requester}; {"responder", "observations", "removals"[, "seq_high"]}
