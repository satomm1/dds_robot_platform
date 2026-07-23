import os

HEARTBEAT_PERIOD = 10  # seconds
HEARTBEAT_TIMEOUT = 31  # seconds

# Max age (seconds) for robot pose to be included on air_quality Influx points.
POSITION_STALE_SEC = float(os.environ.get("POSITION_STALE_SEC", HEARTBEAT_TIMEOUT))
AGENT_TYPE = "human"

PARTICIPANT_LEASE_DURATION_MS = 30000

DEFAULT_GRAPHQL_PORT = 8000

INFLUX_ORG = "eig"
INFLUX_BUCKET = "home"  # must match DOCKER_INFLUXDB_INIT_BUCKET in compose.yaml
INFLUX_URL = "http://localhost:8086"

OLLAMA_URL = "http://localhost:11434/api/generate"
OLLAMA_IMAGE_MODEL = "llava:7b"


def default_graphql_url(my_ip):
    """Default GraphQL HTTP endpoint on this machine's LAN IP (port from ``GRAPHQL_PORT``)."""
    port = int(os.environ.get("GRAPHQL_PORT", DEFAULT_GRAPHQL_PORT))
    return f"http://{my_ip}:{port}/graphql"


def resolve_graphql_http_url(*, my_ip=None, server_url=None):
    """
    Resolve the GraphQL HTTP endpoint for DDS clients.

    Precedence:
        1. ``server_url`` if not ``None`` (explicit per-process override).
        2. ``GRAPHQL_HTTP_URL`` environment variable (full URL, e.g. ``http://host:8000/graphql``).
        3. ``GRAPHQL_HOST`` + ``GRAPHQL_PORT`` (default port from config / env).
        4. ``default_graphql_url`` using ``my_ip`` or :func:`dds_utils.network.get_ip`.

    The GUI uses ``REACT_APP_GRAPHQL_HTTP_URL`` in ``gui/src/apolloClient.js``; set it to the
    same URL as ``GRAPHQL_HTTP_URL`` when both clients should target one server.
    """
    if server_url is not None:
        return server_url
    explicit = os.environ.get("GRAPHQL_HTTP_URL")
    if explicit and str(explicit).strip():
        return str(explicit).strip()
    host = os.environ.get("GRAPHQL_HOST")
    port = int(os.environ.get("GRAPHQL_PORT", DEFAULT_GRAPHQL_PORT))
    if host and str(host).strip():
        return f"http://{str(host).strip()}:{port}/graphql"
    from .network import get_ip

    ip = my_ip if my_ip is not None else get_ip()
    return default_graphql_url(ip)
