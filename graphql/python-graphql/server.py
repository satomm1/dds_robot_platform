from ariadne import load_schema_from_path, make_executable_schema, gql, QueryType, SubscriptionType, MutationType
from ariadne.asgi import GraphQL
from ariadne.asgi.handlers import GraphQLTransportWSHandler
from fastapi import FastAPI
import uvicorn
from starlette.applications import Starlette
from starlette.middleware.cors import CORSMiddleware
from starlette.routing import Route, WebSocketRoute
from starlette.websockets import WebSocketDisconnect

from queries import query
from mutations import mutation
from subscriptions import subscription
from fastapi.middleware.cors import CORSMiddleware

import time

# Load schema from schema.graphql file
type_defs = gql(load_schema_from_path("schema.graphql"))
    
# Create executable schema
schema = make_executable_schema(type_defs, query, mutation, subscription)

# Without using starlette
# app = GraphQL(schema, 
#               websocket_handler=GraphQLTransportWSHandler(),
#               debug=True)

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
    
    uvicorn.run(app, host="0.0.0.0", port=8000)
