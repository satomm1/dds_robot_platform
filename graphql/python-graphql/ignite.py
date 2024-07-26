from pyignite import Client
import time

time.sleep(10)

# Set up the Ignite client
ignite_client = Client()
ignite_client.connect('ignite_host', 10800)