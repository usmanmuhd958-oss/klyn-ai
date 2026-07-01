import os
import json
import time
import secrets
from datetime import datetime

BASE = "."

# =========================
# UTILITIES
# =========================

def write_file(path, content):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        f.write(content)


def json_log(level, module, message):
    return json.dumps({
        "timestamp": datetime.utcnow().isoformat(),
        "log_level": level,
        "module": module,
        "message": message
    })


# =========================
# 1. API MODULE (TOKEN AUTH)
# =========================

api_py = r'''
import json
import os
import secrets
from datetime import datetime

TOKENS = {"admin": "root-token-123"}

LEDGER = "runtime/v6/ledger/jobs.jsonl"

def authenticate(token: str):
    return token in TOKENS.values()


def submit_job(token, job_type, payload):
    if not authenticate(token):
        return {"error": "unauthorized"}

    job = {
        "id": secrets.token_hex(8),
        "type": job_type,
        "payload": payload,
        "status": "pending",
        "ts": datetime.utcnow().isoformat()
    }

    os.makedirs(os.path.dirname(LEDGER), exist_ok=True)

    with open(LEDGER, "a") as f:
        f.write(json.dumps(job) + "\n")

    return {"status": "submitted", "job_id": job["id"]}
'''


# =========================
# 2. SCHEDULER (ASYNC CORE)
# =========================

scheduler_py = r'''
import asyncio
import json
import os

LEDGER = "runtime/v6/ledger/jobs.jsonl"

async def dispatch(job):
    print(f"[SCHEDULER] dispatching {job['type']}")
    await asyncio.sleep(0.1)


async def run_scheduler():
    while True:
        if os.path.exists(LEDGER):
            with open(LEDGER) as f:
                lines = f.readlines()

            for line in lines[-5:]:
                try:
                    job = json.loads(line)
                    await dispatch(job)
                except:
                    continue

        await asyncio.sleep(1)
'''


# =========================
# 3. NODE DAEMON (ASYNC WORKER)
# =========================

node_daemon_py = r'''
import asyncio
import json
import os

LEDGER = "runtime/v6/ledger/jobs.jsonl"

async def execute(job):
    print(f"[NODE] executing {job['type']} -> {job['payload']}")
    await asyncio.sleep(0.2)


async def node_loop():
    while True:
        if os.path.exists(LEDGER):
            with open(LEDGER) as f:
                jobs = f.readlines()

            for line in jobs[-3:]:
                try:
                    job = json.loads(line)
                    await execute(job)
                except:
                    continue

        await asyncio.sleep(1)
'''


# =========================
# 4. CLUSTER MODULE
# =========================

cluster_py = r'''
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
'''


# =========================
# 5. RECOVERY ENGINE (SELF-HEALING)
# =========================

recovery_py = r'''
import os
import json

FILES = [
    "runtime/v6/ledger/jobs.jsonl",
    "runtime/v6/state/cluster.json"
]

def fix_jsonl(path):
    if not os.path.exists(path):
        open(path, "w").close()
        return

    fixed = []
    with open(path) as f:
        for line in f:
            try:
                json.loads(line)
                fixed.append(line)
            except:
                continue

    with open(path, "w") as f:
        f.writelines(fixed)


def recover():
    os.makedirs("runtime/v6/ledger", exist_ok=True)
    os.makedirs("runtime/v6/state", exist_ok=True)

    for f in FILES:
        fix_jsonl(f)

    return {"status": "recovered"}
'''


# =========================
# 6. MASTER KERNEL
# =========================

master_py = r'''
import asyncio
from kernel.v6.scheduler.scheduler import run_scheduler
from kernel.v6.cluster.node_daemon import node_loop
from kernel.v6.recovery.recovery import recover

async def main():
    print("[MASTER] booting KLYN OS v6 kernel")

    recover()

    await asyncio.gather(
        run_scheduler(),
        node_loop()
    )

if __name__ == "__main__":
    asyncio.run(main())
'''


# =========================
# WRITE FILES
# =========================

files = {
    "kernel/v6/core/api.py": api_py,
    "kernel/v6/scheduler/scheduler.py": scheduler_py,
    "kernel/v6/cluster/node_daemon.py": node_daemon_py,
    "kernel/v6/cluster/cluster.py": cluster_py,
    "kernel/v6/recovery/recovery.py": recovery_py,
    "kernel/v6/core/master.py": master_py,
}

for path, content in files.items():
    write_file(path, content)
    print(f"[OK] wrote {path}")

print("\n[KLYN] Kernel upgrade complete.")
print("Run: python -m kernel.v6.core.master")
