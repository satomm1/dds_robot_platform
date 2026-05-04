import logging
import os
import time
from typing import Optional

from pyignite import Client

logger = logging.getLogger(__name__)

ignite_client = Client()
_connected = False


def is_ignite_connected() -> bool:
    return _connected


def connect_ignite(max_retries: int = 60, delay_s: float = 1.0) -> None:
    """Connect to Ignite with retries (replaces fixed import-time sleep)."""
    global _connected
    if _connected:
        return
    host = os.environ.get("IGNITE_HOST", "ignite_host")
    port = int(os.environ.get("IGNITE_PORT", "10800"))
    last_exc: Optional[Exception] = None
    for attempt in range(max_retries):
        try:
            ignite_client.connect(host, port)
            _connected = True
            logger.info("Connected to Ignite at %s:%s", host, port)
            return
        except Exception as e:
            last_exc = e
            logger.warning(
                "Ignite connect attempt %s/%s failed: %s",
                attempt + 1,
                max_retries,
                e,
            )
            time.sleep(delay_s)
    raise ConnectionError(
        f"Could not connect to Ignite at {host}:{port} after {max_retries} attempts"
    ) from last_exc


def ensure_ignite() -> None:
    """Alias for callers that only need to guarantee a session exists."""
    connect_ignite()