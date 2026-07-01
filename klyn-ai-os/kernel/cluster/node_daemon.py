import asyncio, time
from kernel.cluster.cluster import heartbeat
from kernel.core.master import log

NODE_ID = "node-1"

async def beat():
    while True:
        heartbeat(NODE_ID)
        await asyncio.sleep(2)

async def run():
    log("INFO", "node", "node daemon started")
    await beat()