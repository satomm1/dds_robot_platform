import logging
import os

from ignite import connect_ignite, is_ignite_connected

logging.basicConfig(
    level=os.environ.get("GRAPHQL_LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
)
logger = logging.getLogger(__name__)

connect_ignite()

from ariadne import load_schema_from_path, make_executable_schema, gql, QueryType, SubscriptionType, MutationType
from ariadne.asgi import GraphQL
from ariadne.asgi.handlers import GraphQLTransportWSHandler
import uvicorn
from starlette.applications import Starlette
from starlette.middleware.cors import CORSMiddleware
from starlette.responses import JSONResponse, Response
from starlette.routing import Route, WebSocketRoute

from global_transform import init_global_transform_from_file
from queries import query
from mutations import mutation
from subscriptions import subscription
from robot_images import ensure_image_dir, load_jpeg, save_latest

# Precompute global↔central SE(2) from common-points file into Ignite.
if init_global_transform_from_file():
    logger.info("global_transform initialized from common points file")
else:
    logger.warning(
        "global_transform not initialized; globalRobot* / setGlobalRobotGoal unavailable"
    )

ensure_image_dir()

# Load schema from schema.graphql file
type_defs = gql(load_schema_from_path("schema.graphql"))

# Create executable schema
schema = make_executable_schema(type_defs, query, mutation, subscription)

debug_flag = os.environ.get("GRAPHQL_DEBUG", "false").lower() in ("1", "true", "yes")

# Using starlette to handle http and websocket requests
graphql_app = GraphQL(
    schema,
    debug=debug_flag,
    websocket_handler=GraphQLTransportWSHandler(),
)


async def health_liveness(_):
    return JSONResponse({"status": "ok"})


async def health_readiness(_):
    if is_ignite_connected():
        return JSONResponse({"status": "ready"})
    return JSONResponse({"status": "not_ready"}, status_code=503)


async def get_latest_robot_image(request):
    robot_id = int(request.path_params["robot_id"])
    jpeg_bytes, meta = load_jpeg(robot_id)
    if jpeg_bytes is None:
        return JSONResponse({"error": "no image"}, status_code=404)
    headers = {"X-Robot-Id": str(robot_id)}
    if meta:
        if meta.get("timestamp") is not None:
            headers["X-Capture-Timestamp"] = str(meta["timestamp"])
        if meta.get("width") is not None:
            headers["X-Image-Width"] = str(meta["width"])
        if meta.get("height") is not None:
            headers["X-Image-Height"] = str(meta["height"])
    return Response(jpeg_bytes, media_type="image/jpeg", headers=headers)


async def post_latest_robot_image(request):
    """Internal ingest from DDS image_subscriber (raw JPEG body)."""
    robot_id = int(request.path_params["robot_id"])
    body = await request.body()
    if not body:
        return JSONResponse({"error": "empty body"}, status_code=400)
    ts = request.headers.get("x-capture-timestamp")
    width = request.headers.get("x-image-width")
    height = request.headers.get("x-image-height")
    try:
        save_latest(
            robot_id,
            body,
            timestamp=float(ts) if ts is not None else None,
            width=int(width) if width is not None else None,
            height=int(height) if height is not None else None,
        )
    except (ValueError, OSError) as exc:
        logger.exception("image save failed robot_id=%s: %s", robot_id, exc)
        return JSONResponse({"error": "save failed"}, status_code=500)
    return JSONResponse({"ok": True})


app = Starlette(
    routes=[
        Route("/health", health_liveness, methods=["GET"]),
        Route("/ready", health_readiness, methods=["GET"]),
        Route(
            "/robots/{robot_id:int}/image/latest",
            get_latest_robot_image,
            methods=["GET"],
        ),
        Route(
            "/robots/{robot_id:int}/image/latest",
            post_latest_robot_image,
            methods=["POST"],
        ),
        Route('/graphql', graphql_app.handle_request, methods=['GET', 'POST', 'OPTIONS']),
        WebSocketRoute('/graphql', graphql_app.handle_websocket),
    ],
)

# Enable CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)

if __name__ == "__main__":
    bind_host = os.environ.get("GRAPHQL_BIND_HOST", "0.0.0.0")
    bind_port = int(os.environ.get("GRAPHQL_BIND_PORT", "8000"))
    uvicorn.run(app, host=bind_host, port=bind_port)
