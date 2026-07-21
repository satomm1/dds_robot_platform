# Application data API

This note is for application developers who need **live robot state**, the ability to **set goals**, and **latest camera images**.

- **Positions, goals, map, objects, goals (write):** GraphQL over HTTP (latest snapshots from Ignite). Poll for updates; there is no supported push/subscription API for these fields today.
- **Camera images:** separate HTTP endpoints that return **JPEG bytes** (latest frame per robot). Images are **not** delivered through GraphQL.

## GraphQL endpoint


|        |                                                           |
| ------ | --------------------------------------------------------- |
| URL    | `http://localhost:8000/graphql`                           |
| Method | `POST`                                                    |
| Header | `Content-Type: application/json`                          |
| Body   | `{ "query": "<GraphQL document>", "variables": { ... } }` |


If the API runs on another host, replace `localhost` with that machine’s address.

### Minimal request (curl)

```bash
curl -s http://localhost:8000/graphql \
  -H 'Content-Type: application/json' \
  -d '{"query":"{ robotPositions { id x y theta position_timestamp } }"}'
```

Successful responses look like:

```json
{
  "data": { ... }
}
```

Errors appear under `"errors"` (GraphQL) in addition to or instead of `"data"`.

### Coordinate notes

- The default position/goal/map/object fields use the **central / map frame** (meters). This is what the desktop GUI uses.
- Global-map clients should use the **`globalRobot*` / `setGlobalRobotGoal`** APIs instead (see [Global map client](#global-map-client)); those return and accept coordinates in the **global map** frame (meters). Conversion is handled by the server.
- `theta` / `theta_goal` are angles in **radians**.
- Timestamps are **Unix time in seconds** as GraphQL `Float` (fractional seconds supported), e.g. `time.time()` / `Date.now() / 1000`. Pose and image stamps come from the robot DDS message (`Location.timestamp` / `ImageMessage.timestamp`, both `float` on the wire).

---



## 1. Robot positions

Latest pose for each robot that has reported a position.

### Query

```graphql
query {
  robotPositions {
    id
    x
    y
    theta
    position_timestamp
  }
}
```

Single robot:

```graphql
query {
  robotPosition(robot_id: 3) {
    x
    y
    theta
    position_timestamp
  }
}
```

Note: `robotPosition` does not return `id`; use the `robot_id` you passed in.

### Example response

```json
{
  "data": {
    "robotPositions": [
      {
        "id": 3,
        "x": 1.25,
        "y": -0.40,
        "theta": 0.78,
        "position_timestamp": 1721280000.5
      },
      {
        "id": 4,
        "x": 2.10,
        "y": 0.15,
        "theta": -1.20,
        "position_timestamp": 1721280001.1
      }
    ]
  }
}
```


| Field                | Type  | Meaning                                 |
| -------------------- | ----- | --------------------------------------- |
| `id`                 | Int   | Robot / agent ID                        |
| `x`, `y`             | Float | Position (meters, map frame)            |
| `theta`              | Float | Heading (radians)                       |
| `position_timestamp` | Float | Pose capture time (Unix seconds, fractional OK); may be `null` |


Missing / unknown poses may appear as `null` fields.

---



## 2. Robot goals

Latest commanded (or reported) goal per robot.

### Query

```graphql
query {
  robotGoals {
    id
    x_goal
    y_goal
    theta_goal
    goal_timestamp
    goal_valid
  }
}
```

Single robot:

```graphql
query {
  robotGoal(robot_id: 3) {
    x_goal
    y_goal
    theta_goal
    goal_timestamp
    goal_valid
    goal_from_bot
  }
}
```



### Example response

```json
{
  "data": {
    "robotGoals": [
      {
        "id": 3,
        "x_goal": 4.0,
        "y_goal": 1.5,
        "theta_goal": 0.0,
        "goal_timestamp": 1721280100.0,
        "goal_valid": true
      }
    ]
  }
}
```


| Field              | Type    | Meaning                                                                     |
| ------------------ | ------- | --------------------------------------------------------------------------- |
| `id`               | Int     | Robot / agent ID (`robotGoals` only)                                        |
| `x_goal`, `y_goal` | Float   | Goal position (meters)                                                      |
| `theta_goal`       | Float   | Goal heading (radians)                                                      |
| `goal_timestamp`   | Float   | When the goal was set (Unix seconds)                                        |
| `goal_valid`       | Boolean | Whether the goal is considered valid                                        |
| `goal_from_bot`    | Int     | Present on `robotGoal`; `1` if the goal originated from the robot, else `0` |


---



## 3. Map (occupancy grid)

Central occupancy map and metadata.

### Query

```graphql
query {
  map {
    width
    height
    resolution
    origin_x
    origin_y
    origin_z
    origin_orientation_x
    origin_orientation_y
    origin_orientation_z
    origin_orientation_w
    occupancy
  }
}
```



### Example response (truncated)

```json
{
  "data": {
    "map": {
      "width": 200,
      "height": 200,
      "resolution": 0.05,
      "origin_x": -5.0,
      "origin_y": -5.0,
      "origin_z": 0.0,
      "origin_orientation_x": 0.0,
      "origin_orientation_y": 0.0,
      "origin_orientation_z": 0.0,
      "origin_orientation_w": 1.0,
      "occupancy": [0, 0, 100, -1, 0]
    }
  }
}
```


| Field             | Type    | Meaning                                                                                                                                                               |
| ----------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `width`, `height` | Int     | Grid size (cells)                                                                                                                                                     |
| `resolution`      | Float   | Meters per cell                                                                                                                                                       |
| `origin_*`        | Float   | Map origin pose in the world / map frame                                                                                                                              |
| `occupancy`       | `[Int]` | Flat grid of length `width * height` (row-major). Typical values follow ROS-style occupancy (`0` free, `100` occupied, `-1` unknown); treat as opaque ints if unsure. |


If no map is loaded, you may get empty `occupancy` and default metadata (`width`/`height` `0`).

---



## 4. Object positions

Detected objects currently stored in the platform.

### Query

```graphql
query {
  objectPositions {
    id
    robot_id
    x
    y
    type
    timestamp
  }
}
```



### Example response

```json
{
  "data": {
    "objectPositions": [
      {
        "id": 0,
        "robot_id": 3,
        "x": 3.2,
        "y": 1.1,
        "type": "person",
        "timestamp": 1721280000.789
      },
      {
        "id": 1,
        "robot_id": 4,
        "x": 0.5,
        "y": -2.0,
        "type": "chair",
        "timestamp": 1721280001.2
      }
    ]
  }
}
```


| Field       | Type   | Meaning                                                               |
| ----------- | ------ | --------------------------------------------------------------------- |
| `id`        | Int    | Index in this result list (not necessarily a stable global object ID) |
| `robot_id`  | Int    | Robot / agent that reported the detection                             |
| `x`, `y`    | Float  | Object position (meters, map frame)                                   |
| `type`      | String | Class / label (e.g. detector class name)                              |
| `timestamp` | Float  | Detection time (Unix seconds, fractional OK); may be `null` for older entries. Entries with a timestamp older than **15 seconds** are removed from the store when positions are queried (`OBJECT_STALE_SEC`). |


---



## 5. Set robot goal

Command a goal for one robot. The platform’s goal publisher picks this up and forwards it over DDS.

### Mutation

```graphql
mutation SetRobotGoal(
  $robotId: Int!
  $xGoal: Float!
  $yGoal: Float!
  $thetaGoal: Float!
  $timestamp: Float!
) {
  setRobotGoal(
    robot_id: $robotId
    x_goal: $xGoal
    y_goal: $yGoal
    theta_goal: $thetaGoal
    goal_timestamp: $timestamp
    from_bot: false
    goal_valid: true
  )
}
```



### Variables example

```json
{
  "robotId": 3,
  "xGoal": 4.0,
  "yGoal": 1.5,
  "thetaGoal": 0.0,
  "timestamp": 1721280100.0
}
```

Use **current Unix time in seconds** for `timestamp` (e.g. `time.time()` in Python, `Date.now() / 1000` in JavaScript).

### Example HTTP body

```json
{
  "query": "mutation SetRobotGoal($robotId: Int!, $xGoal: Float!, $yGoal: Float!, $thetaGoal: Float!, $timestamp: Float!) { setRobotGoal(robot_id: $robotId, x_goal: $xGoal, y_goal: $yGoal, theta_goal: $thetaGoal, goal_timestamp: $timestamp, from_bot: false, goal_valid: true) }",
  "variables": {
    "robotId": 3,
    "xGoal": 4.0,
    "yGoal": 1.5,
    "thetaGoal": 0.0,
    "timestamp": 1721280100.0
  }
}
```



### Example response

```json
{
  "data": {
    "setRobotGoal": true
  }
}
```

`true` means the goal was stored successfully; `false` means the write failed. After setting a goal, you can confirm with the **robot goals** query above.


| Argument           | Type    | Meaning                                  |
| ------------------ | ------- | ---------------------------------------- |
| `robot_id`         | Int     | Target robot                             |
| `x_goal`, `y_goal` | Float   | Goal position (meters, map frame)        |
| `theta_goal`       | Float   | Goal heading (radians)                   |
| `goal_timestamp`   | Float   | Unix seconds when the goal was issued    |
| `from_bot`         | Boolean | Use `false` for application-issued goals |
| `goal_valid`       | Boolean | Use `true` for a normal active goal      |


---



## Global map client

Use this section if your application works in a **different global map** than the platform’s central / GUI map. The server converts automatically: you only read and write global-frame coordinates.

**Do not** use `robotPositions` / `objectPositions` / `setRobotGoal` from a global-map app — those are central-frame (for the GUI). Use:

| Need | Global API |
| ---- | ---------- |
| Read poses | `globalRobotPositions` / `globalRobotPosition(robot_id)` |
| Read goals | `globalRobotGoals` / `globalRobotGoal(robot_id)` |
| Read objects | `globalObjectPositions` |
| Set goal | `setGlobalRobotGoal(...)` |

### Query positions (global frame)

```graphql
query {
  globalRobotPositions {
    id
    x
    y
    theta
    position_timestamp
  }
}
```

Single robot:

```graphql
query {
  globalRobotPosition(robot_id: 3) {
    x
    y
    theta
    position_timestamp
  }
}
```

Field meanings match the central `robotPositions` API, but `x` / `y` / `theta` are in the **global map**.

**Heading conventions** (server converts automatically; radians):

| Frame | `theta = 0` | `+π/2` | `±π` | `−π/2` |
| ----- | ----------- | ------ | ---- | ------ |
| Global (`globalRobot*`) | East (+X) | South (+Y) | West (−X) | North (−Y) |
| Central (GUI / `robotPositions`) | left (+X) | down (+Y) | right (−X) | up (−Y) |

Both increase counterclockwise in their own map axes; the X-mirror between maps is handled by `R`.

### Query goals (global frame)

```graphql
query {
  globalRobotGoals {
    id
    x_goal
    y_goal
    theta_goal
    goal_timestamp
    goal_valid
  }
}
```

### Query object positions (global frame)

```graphql
query {
  globalObjectPositions {
    id
    robot_id
    x
    y
    type
    timestamp
  }
}
```

Same fields as central `objectPositions`, with `x` / `y` in the **global map**.

### Set goal (global frame)

```graphql
mutation {
  setGlobalRobotGoal(
    robot_id: 3
    x_goal: 4.0
    y_goal: 1.5
    theta_goal: 0.0
    goal_timestamp: 1721280100.0
    goal_valid: true
  )
}
```

Arguments match `setRobotGoal` except there is no `from_bot` (application goals only). The server stores the goal in central coordinates so robots receive it as usual.

If the global↔central alignment is not configured, these operations return a GraphQL error (they will not silently return central coordinates).

### Operator: common points file

Alignment is **not** configured via GraphQL. Edit the landmark file and restart the GraphQL server:

- Default path: `graphql/python-graphql/global_common_points.txt`
- Override with env `GLOBAL_COMMON_POINTS_PATH`
- Format (one shared landmark per line; `#` comments allowed):

```text
# central_x,central_y,global_x,global_y
3.45,2.47,10.1,4.2
7.69,5.39,14.3,7.1
7.59,10.03,14.2,11.8
```

On startup the server computes a **similarity** transform (uniform scale + rotation or reflection + translation) from these ordered pairs and stores it in Ignite. Updating alignment = edit the file and restart GraphQL.

**Mirrored axes** (e.g. central `+X` left vs global `+X` right, both `+Y` down) are supported: landmark pairs discover a reflection automatically—no extra flip config. Prefer **≥3 non-collinear** landmarks in meters so scale and reflection are well constrained.

Optional ops checks:

- Query `globalTransform { R t s timestamp }`
- Startup log includes `s=...` and `det(R)=...`; `det(R) ≈ -1` means a reflection was fitted; `s ≠ 1` means the maps differ in scale

---



## 6. Robot images (latest frame)

Live camera frames are kept as a **single latest JPEG per robot** on the central machine (overwritten when a newer frame arrives from the DDS `image_subscriber` bridge). Application code should fetch that JPEG over **HTTP** — not via GraphQL pixel arrays, Ignite, or a shared filesystem path.

Requires the Docker GraphQL stack and host DDS scripts (including `image_subscriber.py`) to be running.

This works whether your Python runs on **Windows**, **WSL2**, or in **Docker**: you only need a reachable URL. Inside a Docker container, use `host.docker.internal` (Docker Desktop) or the host’s LAN IP instead of `localhost`.

### Image endpoint

Base URL (same host as GraphQL unless noted otherwise): `http://localhost:8000`


|                |                                                                                       |
| -------------- | ------------------------------------------------------------------------------------- |
| Latest frame   | `GET /robots/{robot_id}/image/latest`                                                 |
| Success body   | Raw **JPEG** bytes (`Content-Type: image/jpeg`)                                       |
| Typical errors | `404` if that robot has no frame yet                                                  |


Response headers:


| Header                | Meaning                                 |
| --------------------- | --------------------------------------- |
| `X-Robot-Id`          | Robot / agent ID                        |
| `X-Capture-Timestamp` | Frame capture time (Unix seconds, float string; fractional OK) |
| `X-Image-Width`       | Width in pixels (if known)              |
| `X-Image-Height`      | Height in pixels (if known)             |

`POST /robots/{robot_id}/image/latest` is **internal** (used by the DDS image bridge to upload frames). Application code should only use **GET**.




### curl examples

Download the latest frame for robot `3`:

```bash
curl -sS -o robot_3.jpg \
  -D - \
  http://localhost:8000/robots/3/image/latest
```

Check headers only:

```bash
curl -sS -I http://localhost:8000/robots/3/image/latest
```

Example success headers:

```http
HTTP/1.1 200 OK
Content-Type: image/jpeg
Content-Length: 48210
X-Robot-Id: 3
X-Capture-Timestamp: 1721280200.25
X-Image-Width: 640
X-Image-Height: 480
```



### Using the image for processing

Poll `GET /robots/{robot_id}/image/latest` at the rate your pipeline needs (often 1–5 Hz). Decode the response body as JPEG (OpenCV, Pillow, etc.). Use `X-Capture-Timestamp` to drop stale frames or align with pose queries.

For multiple robots, request each `robot_id` separately (one latest slot per robot).

### GraphQL metadata

```graphql
query {
  robotImageMeta(robot_id: 3) {
    robot_id
    timestamp
    width
    height
    url
  }
}
```

Example response shape:

```json
{
  "data": {
    "robotImageMeta": {
      "robot_id": 3,
      "timestamp": 1721280200.25,
      "width": 640,
      "height": 480,
      "url": "http://localhost:8000/robots/3/image/latest"
    }
  }
}
```

Returns `null` if no frame is stored yet. Pixels still come from the **HTTP JPEG** URL, not from GraphQL.

---



## Python example (requests)

```python
import io
import time
import requests
from PIL import Image

GRAPHQL_URL = "http://localhost:8000/graphql"
IMAGE_BASE = "http://localhost:8000"
# From Docker Desktop on Windows/Mac, you may need:
# IMAGE_BASE = "http://host.docker.internal:8000"
# GRAPHQL_URL = "http://host.docker.internal:8000/graphql"

def gql(query, variables=None):
    r = requests.post(GRAPHQL_URL, json={"query": query, "variables": variables or {}})
    r.raise_for_status()
    body = r.json()
    if body.get("errors"):
        raise RuntimeError(body["errors"])
    return body["data"]

# Read state (GraphQL)
positions = gql("{ robotPositions { id x y theta position_timestamp } }")
goals = gql("{ robotGoals { id x_goal y_goal theta_goal goal_timestamp goal_valid } }")
omap = gql("{ map { width height resolution occupancy origin_x origin_y } }")
objects = gql("{ objectPositions { id robot_id x y type timestamp } }")

# Write goal (GraphQL)
gql(
    """
    mutation SetRobotGoal(
      $robotId: Int!, $xGoal: Float!, $yGoal: Float!,
      $thetaGoal: Float!, $timestamp: Float!
    ) {
      setRobotGoal(
        robot_id: $robotId, x_goal: $xGoal, y_goal: $yGoal,
        theta_goal: $thetaGoal, goal_timestamp: $timestamp,
        from_bot: false, goal_valid: true
      )
    }
    """,
    {
        "robotId": 3,
        "xGoal": 4.0,
        "yGoal": 1.5,
        "thetaGoal": 0.0,
        "timestamp": time.time(),
    },
)

# Latest camera frame (HTTP JPEG)
def fetch_latest_image(robot_id: int):
    r = requests.get(f"{IMAGE_BASE}/robots/{robot_id}/image/latest", timeout=5)
    r.raise_for_status()
    ts = r.headers.get("X-Capture-Timestamp")
    img = Image.open(io.BytesIO(r.content))
    return img, float(ts) if ts is not None else None

# img, ts = fetch_latest_image(3)
```

---



## Polling

GraphQL queries and the image `GET` return the **current** stored values. For a live view:

- **State (poses, goals, …):** poll GraphQL (the desktop GUI typically polls positions on the order of ~2 seconds).
- **Images:** poll `GET /robots/{robot_id}/image/latest` at your processing rate.

Choose rates that fit your application; avoid hammering endpoints faster than you need.

## Out of scope for this note

- Full GraphQL schema / other queries (air quality, scans, multi-robot plans, …)
- Historical time series (InfluxDB)
- Archived capture sessions (`capture/` upload API)
- Direct DDS or Ignite access

