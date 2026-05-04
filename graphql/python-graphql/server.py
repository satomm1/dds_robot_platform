import os

from ariadne import load_schema_from_path, make_executable_schema, gql, QueryType, SubscriptionType, MutationType
from ariadne.asgi import GraphQL
from ariadne.asgi.handlers import GraphQLTransportWSHandler
import uvicorn
from starlette.applications import Starlette
from starlette.middleware.cors import CORSMiddleware
from starlette.routing import Route, WebSocketRoute

from queries import query
from mutations import mutation
from subscriptions import subscription

# Load schema from schema.graphql file
type_defs = gql(load_schema_from_path("schema.graphql"))

# Create executable schema
schema = make_executable_schema(type_defs, query, mutation, subscription)

# Using starlette to handle http and websocket requests
graphql_app = GraphQL(schema, debug=True, websocket_handler=GraphQLTransportWSHandler())
app = Starlette(
    routes=[
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
