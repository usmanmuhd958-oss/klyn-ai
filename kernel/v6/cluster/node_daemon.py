import asyncio
import json
import os
import time

from kernel.v6.core.logger import logger

NODES = "runtime/cluster/nodes.jsonl"


async def node_loop(node_id="node-1"):
    os.makedirs("runtime/cluster", exist_ok=True)

    logger._write("INFO", "node", "Node daemon started")

    while True:
        await asyncio.sleep(2)

        node = {
            "id": node_id,
            "ts": time.time(),
            "status": "alive"
        }

        with open(NODES, "a") as f:
            f.write(json.dumps(node) + "\n")

        logger._write("INFO", "node", "heartbeat sent")
