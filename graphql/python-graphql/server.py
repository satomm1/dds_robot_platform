import os

from ignite import connect_ignite, is_ignite_connected

connect_ignite()

from ariadne import load_schema_from_path, make_executable_schema, gql, QueryType, SubscriptionType, MutationType
from ariadne.asgi import GraphQL
from ariadne.asgi.handlers import GraphQLTransportWSHandler
import uvicorn
from starlette.applications import Starlette
from starlette.middleware.cors import CORSMiddleware
from starlette.responses import JSONResponse
from starlette.routing import Route, WebSocketRoute

from queries import query
from mutations import mutation
from subscriptions import subscription

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


app = Starlette(
    routes=[
        Route("/health", health_liveness, methods=["GET"]),
        Route("/ready", health_readiness, methods=["GET"]),
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
