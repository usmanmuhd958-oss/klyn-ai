import json, time

LOG = "runtime/logs/events.jsonl"

def log(level, module, message):
    entry = {
        "timestamp": time.time(),
        "level": level,
        "module": module,
        "message": message
    }
    print(json.dumps(entry))
    with open(LOG, "a") as f:
        f.write(json.dumps(entry) + "\n")