import os

BASE = "klyn-ai-os"

def write(path, content):
    full = os.path.join(BASE, path)
    os.makedirs(os.path.dirname(full), exist_ok=True)
    with open(full, "w") as f:
        f.write(content.strip())

print("[INSTALL] Building KLYN OS v6 Async Kernel...")

# =========================
# BOOTSTRAP / RECOVERY CORE
# =========================
write("kernel/recovery/recovery.py", """
import os, json

REQUIRED = [
    "runtime/ledger",
    "runtime/cluster",
    "runtime/lock",
    "runtime/logs"
]

def ensure_dirs():
    for d in REQUIRED:
        os.makedirs(d, exist_ok=True)

def ensure_files():
    ledger = "runtime/ledger/jobs.jsonl"
    if not os.path.exists(ledger):
        open(ledger, "w").close()

    cluster = "runtime/cluster/nodes.jsonl"
    if not os.path.exists(cluster):
        open(cluster, "w").close()

def run():
    ensure_dirs()
    ensure_files()
    print("[RECOVERY] system validated")

if __name__ == "__main__":
    run()
""")

# =========================
# STRUCTURED LOGGER
# =========================
write("kernel/core/master.py", """
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
        f.write(json.dumps(entry) + "\\n")
""")

# =========================
# API (JOB SUBMISSION)
# =========================
write("kernel/core/api.py", """
import json, time
from kernel.core.master import log

LEDGER = "runtime/ledger/jobs.jsonl"

VALID_TOKEN = "klyn-secure-token"

def submit_job(token, job_type, payload, node="auto"):
    if token != VALID_TOKEN:
        log("ERROR", "api", "Invalid token")
        return None

    job = {
        "id": str(time.time()),
        "type": job_type,
        "payload": payload,
        "status": "pending",
        "node": node
    }

    with open(LEDGER, "a") as f:
        f.write(json.dumps(job) + "\\n")

    log("INFO", "api", f"Job submitted: {job_type}")
    return job
""")

# =========================
# CLUSTER
# =========================
write("kernel/cluster/cluster.py", """
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
        f.write(json.dumps(node) + "\\n")

    log("INFO", "cluster", f"heartbeat {node_id}")

def list_nodes():
    if not os.path.exists(STATE):
        return []
    return [json.loads(x) for x in open(STATE) if x.strip()]
""")

# =========================
# SCHEDULER (ASYNC CORE)
# =========================
write("kernel/scheduler/scheduler.py", """
import asyncio, json, os
from kernel.core.master import log

LEDGER = "runtime/ledger/jobs.jsonl"
LOCK = "runtime/lock/scheduler.lock"

async def load_jobs():
    if not os.path.exists(LEDGER):
        return []
    jobs = []
    with open(LEDGER) as f:
        for line in f:
            if line.strip():
                jobs.append(json.loads(line))
    return jobs

def acquire_lock():
    if os.path.exists(LOCK):
        return False
    open(LOCK, "w").close()
    return True

def release_lock():
    if os.path.exists(LOCK):
        os.remove(LOCK)

async def process_job(job):
    log("INFO", "scheduler", f"processing {job['type']}")
    job["status"] = "done"

async def run():
    while True:
        if not acquire_lock():
            await asyncio.sleep(0.5)
            continue

        jobs = await load_jobs()

        for job in jobs:
            if job.get("status") == "pending":
                await process_job(job)

        release_lock()
        await asyncio.sleep(1)
""")

# =========================
# NODE DAEMON (ASYNC)
# =========================
write("kernel/cluster/node_daemon.py", """
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
""")

# =========================
# BOOT LOADER (ONLY ENTRYPOINT)
# =========================
write("boot_v6.py", """
import asyncio
from kernel.recovery.recovery import run as recover
from kernel.scheduler.scheduler import run as scheduler
from kernel.cluster.node_daemon import run as node

async def main():
    recover()

    await asyncio.gather(
        scheduler(),
        node()
    )

if __name__ == "__main__":
    print("[BOOT] KLYN OS v6 Async Kernel Online")
    asyncio.run(main())
""")

print("[DONE] v6 async kernel generated")
print("Run: python boot_v6.py")
