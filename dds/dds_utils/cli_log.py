"""Small helpers for consistent DDS worker stdout/stderr messages."""

from __future__ import annotations

import os
import sys
import time
from typing import Callable


def is_dds_verbose() -> bool:
    return os.environ.get("DDS_VERBOSE", "").strip().lower() in ("1", "true", "yes")


def dds_log(component: str, *parts: object, file=sys.stdout) -> None:
    msg = " ".join(str(p) for p in parts if p is not None)
    print(f"[{component}] {msg}", file=file, flush=True)


def dds_warn(component: str, *parts: object) -> None:
    dds_log(component, *parts, file=sys.stderr)


class GraphqlPollBackoff:
    """Emit first GraphQL poll failure immediately; repeat warnings at most every interval_sec."""

    def __init__(self, interval_sec: float = 60.0) -> None:
        self.interval_sec = interval_sec
        self._last_emit = 0.0
        self._pending_repeat = False

    def success(self) -> None:
        self._pending_repeat = False

    def failure(self, component: str, fmt: Callable[[], str]) -> None:
        now = time.time()
        if not self._pending_repeat:
            self._pending_repeat = True
            self._last_emit = now
            dds_warn(component, fmt())
            return
        if now - self._last_emit >= self.interval_sec:
            self._last_emit = now
            dds_warn(component, fmt())


class ImageLogThrottle:
    """Summarize high-frequency image receipts; optional per-frame lines when DDS_VERBOSE."""

    def __init__(self, summary_interval_sec: float = 30.0) -> None:
        self.summary_interval_sec = summary_interval_sec
        self._window_count = 0
        self._window_start = time.time()
        self._last_ts: int | None = None
        self._logged_first = False

    def record(self, component: str, timestamp: int) -> None:
        self._last_ts = timestamp
        now = time.time()
        if is_dds_verbose():
            dds_log(component, f"image ts={timestamp}")
            return
        if not self._logged_first:
            self._logged_first = True
            self._window_start = now
            self._window_count = 1
            dds_log(component, f"first image ts={timestamp}")
            return
        self._window_count += 1
        if now - self._window_start >= self.summary_interval_sec:
            dds_log(
                component,
                f"images in ~{self.summary_interval_sec:.0f}s: {self._window_count}, last_ts={self._last_ts}",
            )
            self._window_start = now
            self._window_count = 0
