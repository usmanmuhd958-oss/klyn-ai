import os
import json
import time
from pathlib import Path

BASE = Path(".")

# ----------------------------
# DIRECTORY BOOTSTRAP
# ----------------------------
DIRS = [
    "kernel/v6/cluster",
    "kernel/v6/core",
    "kernel/v6/scheduler",
    "kernel/v6/recovery",
    "runtime/v6/state",
    "runtime/v6/ledger",
    "runtime/v6/queue",
    "runtime/v6/logs",
]

for d in DIRS:
    Path(d).mkdir(parents=True, exist_ok=True)


# ----------------------------
# SAFE FILE WRITER
# ----------------------------
def write(path, content):
    Path(path).write_text(content.strip() + "\n")


# ----------------------------
# 1. CLUSTER MANAGER
# ----------------------------
write("kernel/v6/cluster/cluster.py", """
import json
from pathlib import Path

STATE = Path("runtime/v6/state/cluster.json")

class Cluster:
    def __init__(self):
        STATE.parent.mkdir(parents=True, exist_ok=True)
        if not STATE.exists():
            STATE.write_text(json.dumps({
                "status": "booting",
                "leader": "local",
                "nodes": [],
                "version": "v6"
            }))

    def _load(self):
        return json.loads(STATE.read_text())

    def _save(self, data):
        STATE.write_text(json.dumps(data, indent=2))

    def register_node(self, node_id: str):
        data = self._load()
        if node_id not in data["nodes"]:
            data["nodes"].append(node_id)
        self._save(data)

    def list_nodes(self):
        return self._load()["nodes"]
""")


# ----------------------------
# 2. API LAYER (JOB SUBMISSION)
# ----------------------------
write("kernel/v6/core/api.py", """
import json
import time
from pathlib import Path

LEDGER = Path("runtime/v6/ledger/jobs.jsonl")

class API:
    def __init__(self):
        LEDGER.parent.mkdir(parents=True, exist_ok=True)
        LEDGER.touch(exist_ok=True)

    def submit_job(self, job_type: str, payload: str, node="auto"):
        job = {
            "id": str(int(time.time() * 1e9)),
            "type": job_type,
            "payload": payload,
            "node": node,
            "status": "pending"
        }
        with open(LEDGER, "a") as f:
            f.write(json.dumps(job) + "\\n")

        return job["id"]
""")


# ----------------------------
# 3. SCHEDULER
# ----------------------------
write("kernel/v6/scheduler/scheduler.py", """
import json

def dispatch(job: dict):
    job_type = job.get("type")
    payload = job.get("payload")

    if job_type == "build":
        print("[SCHEDULER] build -> coder", payload)
    elif job_type == "execute":
        print("[SCHEDULER] execute -> executor", payload)
    elif job_type == "review":
        print("[SCHEDULER] review -> reviewer", payload)
    else:
        print("[SCHEDULER] plan -> planner", payload)
""")


# ----------------------------
# 4. NODE DAEMON (MAIN ENGINE)
# ----------------------------
write("kernel/v6/cluster/node_daemon.py", """
import json
import time
from pathlib import Path
from kernel.v6.scheduler.scheduler import dispatch

LEDGER = Path("runtime/v6/ledger/jobs.jsonl")

def read_jobs():
    if not LEDGER.exists():
        return []

    jobs = []
    with open(LEDGER) as f:
        for line in f:
            try:
                jobs.append(json.loads(line))
            except:
                continue
    return jobs


def mark_done(job):
    job["status"] = "done"


def run():
    print("[NODE] v6 daemon started")

    while True:
        jobs = read_jobs()

        for job in jobs:
            if job.get("status") == "pending":
                print("[NODE] executing:", job["type"])
                dispatch(job)
                job["status"] = "done"

        time.sleep(1)


if __name__ == "__main__":
    run()
""")


# ----------------------------
# 5. RECOVERY SYSTEM
# ----------------------------
write("kernel/v6/recovery/recovery.py", """
import os
from pathlib import Path

def ensure_dirs():
    dirs = [
        "runtime/v6/state",
        "runtime/v6/ledger",
        "runtime/v6/logs",
        "runtime/v6/queue"
    ]

    for d in dirs:
        Path(d).mkdir(parents=True, exist_ok=True)


def ensure_state():
    state = Path("runtime/v6/state/cluster.json")

    if not state.exists():
        state.write_text('''
{
  "status": "running",
  "leader": "local",
  "version": "v6"
}
'''.strip())


def recover():
    ensure_dirs()
    ensure_state()
    print("[RECOVERY] system ready")


if __name__ == "__main__":
    recover()
""")


# ----------------------------
# 6. BOOT ENGINE
# ----------------------------
write("boot_v6.py", """
from kernel.v6.recovery.recovery import recover
from kernel.v6.cluster.node_daemon import run

def boot():
    print("[BOOT] KLYN OS v6 Python Kernel Starting...")
    recover()
    run()

if __name__ == "__main__":
    boot()
""")


print("\n[KLYN] v6 Python Kernel installed successfully.")
print("Run: python boot_v6.py\n")
