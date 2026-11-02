#!/usr/bin/env python3
"""Checks for cached Ignite cache handles, one-page scans, and read-only objectPositions.

Uses an in-memory fake client, so no Ignite server is needed.
"""

from __future__ import annotations

import json
import sys
import time

from pyignite.exceptions import CacheError

import ignite
import mutations
import queries


class FakeCache:
    def __init__(self, name, client):
        self.name = name
        self.client = client
        self.rows = client.store.setdefault(name, {})

    def _maybe_fail(self):
        if self.client.fail_next.pop(self.name, False):
            raise CacheError(f"Cache does not exist: {self.name}")

    def get(self, key):
        self._maybe_fail()
        return self.rows.get(key)

    def put(self, key, value):
        self._maybe_fail()
        self.client.writes.append(("put", self.name, key))
        self.rows[key] = value

    def remove_key(self, key):
        self._maybe_fail()
        self.client.writes.append(("remove_key", self.name, key))
        self.rows.pop(key, None)

    def clear(self):
        self._maybe_fail()
        self.client.writes.append(("clear", self.name, None))
        self.rows.clear()

    def scan(self, page_size=1):
        self._maybe_fail()
        self.client.scan_page_sizes.append(page_size)
        return iter(list(self.rows.items()))


class FakeClient:
    def __init__(self):
        self.store = {}
        self.created = []
        self.writes = []
        self.scan_page_sizes = []
        self.fail_next = {}

    def get_or_create_cache(self, name):
        self.created.append(name)
        return FakeCache(name, self)


def _fresh_client() -> FakeClient:
    client = FakeClient()
    ignite.ignite_client = client
    ignite._handles.clear()
    return client


def test_handle_created_once() -> None:
    client = _fresh_client()
    ignite.cache_op("robot_position", lambda c: c.put(1, "a"))
    ignite.cache_op("robot_position", lambda c: c.get(1))
    ignite.scan_rows("robot_position")
    assert client.created == ["robot_position"], client.created


def test_retry_recreates_after_cache_error() -> None:
    client = _fresh_client()
    ignite.cache_op("robot_goal", lambda c: c.put(2, "g"))
    client.fail_next["robot_goal"] = True
    assert ignite.cache_op("robot_goal", lambda c: c.get(2)) == "g"
    assert client.created == ["robot_goal", "robot_goal"], client.created


def test_scan_uses_one_page() -> None:
    client = _fresh_client()
    client.store["robot_position"] = {1: "a", 2: "b"}
    assert ignite.scan_rows("robot_position") == [(1, "a"), (2, "b")]
    assert client.scan_page_sizes == [ignite.SCAN_PAGE_SIZE], client.scan_page_sizes


def test_object_positions_read_only_with_stable_ids() -> None:
    client = _fresh_client()
    now = time.time()
    stored = {
        "-1": {"x": 1.0, "y": 2.0, "class_name": "person", "timestamp": now},
        "-2": {"x": 0.0, "y": 0.0, "class_name": "person", "timestamp": now - 5},  # stale
        "3": {"x": 4.0, "y": 5.0, "class_name": "cone", "timestamp": now - 1},
        "4": {"x": 6.0, "y": 7.0, "class_name": "cone"},  # no timestamp: kept
    }
    client.store["detected_objects"] = {5: json.dumps(stored)}

    result = queries.query._resolvers["objectPositions"](None, None)
    ids = sorted(o["id"] for o in result)
    assert ids == ["5:-1", "5:3", "5:4"], ids
    assert client.writes == [], client.writes  # filtering never writes back
    assert json.loads(client.store["detected_objects"][5]) == stored

    again = queries.query._resolvers["objectPositions"](None, None)
    assert sorted(o["id"] for o in again) == ids  # same ids on every poll


def test_set_objects_prunes_stale_entries() -> None:
    client = _fresh_client()
    now = time.time()
    client.store["detected_objects"] = {
        7: json.dumps({
            "-1": {"x": 0.0, "y": 0.0, "class_name": "person", "timestamp": now - 5},
            "2": {"x": 1.0, "y": 1.0, "class_name": "cone", "timestamp": now},
        })
    }
    ok = mutations.mutation._resolvers["setObjects"](
        None, None, agent_id=7, x=3.0, y=3.0, class_name="person", object_num=-2, timestamp=now
    )
    assert ok is True
    kept = json.loads(client.store["detected_objects"][7])
    assert sorted(kept) == ["-2", "2"], kept


def test_clear_object_prunes_stale_entries() -> None:
    client = _fresh_client()
    now = time.time()
    client.store["detected_objects"] = {
        7: json.dumps({
            "-1": {"x": 0.0, "y": 0.0, "class_name": "person", "timestamp": now - 5},
            "2": {"x": 1.0, "y": 1.0, "class_name": "cone", "timestamp": now},
            "3": {"x": 2.0, "y": 2.0, "class_name": "cone", "timestamp": now},
        })
    }
    assert mutations.mutation._resolvers["clearObject"](None, None, agent_id=7, object_num=3) is True
    assert sorted(json.loads(client.store["detected_objects"][7])) == ["2"]


def main() -> int:
    tests = [
        test_handle_created_once,
        test_retry_recreates_after_cache_error,
        test_scan_uses_one_page,
        test_object_positions_read_only_with_stable_ids,
        test_set_objects_prunes_stale_entries,
        test_clear_object_prunes_stale_entries,
    ]
    for test in tests:
        test()
        print(f"ok  {test.__name__}")
    print(f"{len(tests)} ignite access checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
