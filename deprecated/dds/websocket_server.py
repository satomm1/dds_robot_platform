import asyncio
import websockets
import json

connected_clients = set()

async def handler(websocket, path):
    # Register the client
    connected_clients.add(websocket)
    try:
        await websocket.wait_closed()
    finally:
        # Unregister the client
        connected_clients.remove(websocket)

async def send_message(data):
    if connected_clients:
        message = json.dumps(data)
        await asyncio.wait([client.send(message) for client in connected_clients])

async def start_websocket_server():
    async with websockets.serve(handler, "localhost", 8765):
        await asyncio.Future()  # Run forever

async def main():
    async with websockets.serve(handler, "localhost", 8765):
        await asyncio.Future()  # Run forever

if __name__ == "__main__":
    asyncio.run(main())
