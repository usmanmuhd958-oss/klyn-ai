import json, time, os
from kernel.core.master import log

STATE = "runtime/cluster/nodes.jsonl"

def heartbeat(node_id):
    node = {
        "id": node_id,
        "ts": time.time(),
        "status": "alive"
    }
    with open(STATE, "a") as f:
        f.write(json.dumps(node) + "\n")

    log("INFO", "cluster", f"heartbeat {node_id}")

def list_nodes():
    if not os.path.exists(STATE):
        return []
    return [json.loads(x) for x in open(STATE) if x.strip()]