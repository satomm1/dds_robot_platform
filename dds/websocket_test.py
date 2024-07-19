import asyncio
import websockets
import json
import random
import datetime

class Foo:
    def __init__(self):
        self.data = {}

    def generate_data(self):
        self.data = {
            "timestamp": datetime.datetime.now().isoformat(),
            "value": random.randint(1, 100)  # Replace with your actual data generation logic
        }

    def get_data(self):
        return self.data

async def send_data(websocket, path, foo_instance):
    while True:
        foo_instance.generate_data()
        data = foo_instance.get_data()
        data_json = json.dumps(data)
        await websocket.send(data_json)

        # Simulate variable data arrival interval
        await asyncio.sleep(random.uniform(0.5, 5))  # Adjust the interval as needed

async def main():
    foo_instance = Foo()
    async with websockets.serve(lambda ws, path: send_data(ws, path, foo_instance), "localhost", 8765):
        await asyncio.Future()  # Run forever

if __name__ == "__main__":
    asyncio.run(main())
