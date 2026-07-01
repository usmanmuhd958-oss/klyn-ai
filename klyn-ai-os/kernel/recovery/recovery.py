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