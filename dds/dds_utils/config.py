HEARTBEAT_PERIOD = 10  # seconds
HEARTBEAT_TIMEOUT = 31  # seconds
AGENT_TYPE = "human"

PARTICIPANT_LEASE_DURATION_MS = 30000

DEFAULT_GRAPHQL_PORT = 8000

INFLUX_ORG = "eig"
INFLUX_BUCKET = "first_bucket"
INFLUX_URL = "http://localhost:8086"

OLLAMA_URL = "http://localhost:11434/api/generate"
OLLAMA_IMAGE_MODEL = "llava:7b"


def default_graphql_url(my_ip):
    return f"http://{my_ip}:8000/graphql"
