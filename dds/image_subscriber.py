from cyclonedds.topic import Topic
from cyclonedds.sub import Subscriber, DataReader
from cyclonedds.core import Listener

import io
import os
import signal
import sys
import time

import numpy as np
import requests
from PIL import Image

from dds_utils import (
    AgentIdError,
    GraphqlPollBackoff,
    ImageLogThrottle,
    ImageMessage,
    create_domain_participant,
    dispose_participant,
    dds_log,
    fetch_subscribed_agent_ids_set,
    get_ip,
    image_qos,
    require_agent_id_int,
)
from dds_utils.config import resolve_graphql_http_url
from dds_utils.topics import image_topic_name

IMAGE_UPLOAD_TIMEOUT_SEC = float(os.environ.get("IMAGE_UPLOAD_TIMEOUT_SEC", "8"))
IMAGE_UPLOAD_RETRIES = int(os.environ.get("IMAGE_UPLOAD_RETRIES", "3"))


def _api_base_from_graphql_url(graphql_url: str) -> str:
    """http://host:8000/graphql -> http://host:8000"""
    base = graphql_url.rstrip("/")
    if base.endswith("/graphql"):
        base = base[: -len("/graphql")]
    return base


def _jpeg_bytes_from_sample(sample) -> bytes:
    enc = (sample.encoding or "").strip().lower()
    if enc in ("jpeg", "jpg"):
        return bytes(sample.data)
    arr = np.asarray(sample.data, dtype=np.uint8).reshape((sample.height, sample.width, 3))
    buf = io.BytesIO()
    Image.fromarray(arr, "RGB").save(buf, format="JPEG", quality=85)
    return buf.getvalue()


def _post_jpeg_with_retries(url, jpeg_bytes, *, headers, context):
    last_exc = None
    for attempt in range(1, IMAGE_UPLOAD_RETRIES + 1):
        try:
            response = requests.post(
                url,
                data=jpeg_bytes,
                headers=headers,
                timeout=IMAGE_UPLOAD_TIMEOUT_SEC,
            )
            if response.status_code not in (200, 201):
                raise RuntimeError(f"{context}: HTTP {response.status_code}")
            return response
        except Exception as exc:
            last_exc = exc
            if attempt < IMAGE_UPLOAD_RETRIES:
                time.sleep(0.1 * attempt)
    raise last_exc


class ImageListener(Listener):
    def __init__(self, my_id, topic_id, upload_base, image_throttle=None):
        super().__init__()
        self.my_id = my_id
        self.topic_id = topic_id
        self.upload_base = upload_base.rstrip("/")
        self._image_throttle = image_throttle

    def on_data_available(self, reader):
        # Latest-only: take samples and upload the newest frame (do not queue).
        samples = [
            sample
            for sample in reader.take()
            if sample.agent_id != int(self.my_id)
        ]
        if not samples:
            return
        sample = samples[-1]

        timestamp = sample.timestamp
        if self._image_throttle is not None:
            self._image_throttle.record("img_sub", timestamp)

        try:
            jpeg_bytes = _jpeg_bytes_from_sample(sample)
        except Exception as exc:
            dds_log("img_sub", f"encode failed agent={self.topic_id}: {exc}")
            return

        url = f"{self.upload_base}/robots/{int(self.topic_id)}/image/latest"
        headers = {
            "Content-Type": "image/jpeg",
            "X-Robot-Id": str(int(self.topic_id)),
            "X-Capture-Timestamp": str(float(timestamp)),
            "X-Image-Width": str(int(sample.width)),
            "X-Image-Height": str(int(sample.height)),
        }
        try:
            _post_jpeg_with_retries(
                url,
                jpeg_bytes,
                headers=headers,
                context=f"image upload agent={self.topic_id}",
            )
        except Exception as exc:
            dds_log("img_sub", f"upload failed agent={self.topic_id}: {exc}")


class ImageSubscriber:
    def __init__(self, my_id, server_url=None):
        self.my_id = my_id
        self.my_ip = get_ip()
        self.graphql_server = resolve_graphql_http_url(my_ip=self.my_ip, server_url=server_url)
        self.upload_base = _api_base_from_graphql_url(self.graphql_server)

        self._graphql_warn = GraphqlPollBackoff()
        self._image_throttle = ImageLogThrottle()

        self.subscribed_agents = self.get_agents()

        self.participant = create_domain_participant(domain_qos=True)
        self.subscriber = Subscriber(self.participant)

        self.image_listeners = dict()
        self.image_readers = dict()

        for agent_id in self.subscribed_agents:
            self._subscribe_agent(agent_id)

    def _subscribe_agent(self, agent_id):
        if int(agent_id) == int(self.my_id):
            return
        dds_log("img_sub", f"subscribed to agent {agent_id} images")
        topic = Topic(self.participant, image_topic_name(agent_id), ImageMessage)
        self.image_listeners[agent_id] = ImageListener(
            self.my_id,
            agent_id,
            self.upload_base,
            image_throttle=self._image_throttle,
        )
        self.image_readers[agent_id] = DataReader(
            self.subscriber,
            topic,
            listener=self.image_listeners[agent_id],
            qos=image_qos,
        )

    def run(self):
        dds_log("img_sub", f"ready (upload base {self.upload_base})")
        while True:
            try:
                agents_to_subscribe = self.get_agents()
                self._graphql_warn.success()
                new_agents = agents_to_subscribe - self.subscribed_agents
                old_agents = self.subscribed_agents - agents_to_subscribe

                for agent_id in new_agents:
                    self._subscribe_agent(agent_id)

                for agent_id in old_agents:
                    dds_log("img_sub", f"unsubscribed from agent {agent_id} images")
                    self.image_listeners.pop(agent_id, None)
                    self.image_readers.pop(agent_id, None)

                self.subscribed_agents = agents_to_subscribe
            except Exception as e:
                self._graphql_warn.failure(
                    "img_sub",
                    lambda exc=e: f"GraphQL poll failed: {exc}",
                )

            time.sleep(1)

    def get_agents(self):
        return fetch_subscribed_agent_ids_set(self.graphql_server, self.my_id)

    def shutdown(self):
        dds_log("img_sub", "stopped")
        self.image_readers.clear()
        self.image_listeners.clear()
        self.subscriber = None
        dispose_participant(self.participant)
        self.participant = None


if __name__ == "__main__":
    try:
        agent_id = require_agent_id_int()
    except AgentIdError as exc:
        print(exc, file=sys.stderr)
        sys.exit(1)

    time.sleep(10)  # Wait for entry/initialization

    image_sub = ImageSubscriber(agent_id)

    def handle_signal(sig, frame):
        image_sub.shutdown()
        exit(0)

    signal.signal(signal.SIGTERM, handle_signal)

    try:
        image_sub.run()
    except KeyboardInterrupt:
        dds_log("img_sub", "exiting")
        exit(0)
