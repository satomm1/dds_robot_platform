import logging
import os
import time
from typing import Any, Callable, Dict, List, Optional

from pyignite import Client
from pyignite.cache import Cache
from pyignite.exceptions import CacheError

logger = logging.getLogger(__name__)

ignite_client = Client()
_connected = False

# Cache tables hold one row per robot/agent, so one page covers a whole scan.
SCAN_PAGE_SIZE = 1024

# get_or_create_cache is a network round trip; keep one handle per cache name.
_handles: Dict[str, Cache] = {}


def get_cache(name: str) -> Cache:
    """Handle for cache `name`, created on first use and reused afterwards."""
    handle = _handles.get(name)
    if handle is None:
        handle = ignite_client.get_or_create_cache(name)
        _handles[name] = handle
    return handle


def cache_op(name: str, fn: Callable[[Cache], Any]) -> Any:
    """Run fn(cache). On CacheError (e.g. Ignite restarted and dropped the cache), recreate it and retry once."""
    try:
        return fn(get_cache(name))
    except CacheError as exc:
        logger.info("cache %s op failed (%s); recreating handle and retrying", name, exc)
        _handles.pop(name, None)
        return fn(get_cache(name))


def scan_rows(name: str) -> List[tuple]:
    """All (key, value) rows of cache `name`, fetched in one page."""
    return cache_op(name, lambda c: list(c.scan(page_size=SCAN_PAGE_SIZE)))


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