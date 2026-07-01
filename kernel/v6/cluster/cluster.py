
import json
import os

STATE = "runtime/v6/state/cluster.json"

def register_node(node_id):
    os.makedirs(os.path.dirname(STATE), exist_ok=True)

    if not os.path.exists(STATE):
        data = {"nodes": []}
    else:
        with open(STATE) as f:
            try:
                data = json.load(f)
            except:
                data = {"nodes": []}

    if "nodes" not in data:
        data["nodes"] = []

    if node_id not in data["nodes"]:
        data["nodes"].append(node_id)

    with open(STATE, "w") as f:
        json.dump(data, f, indent=2)
