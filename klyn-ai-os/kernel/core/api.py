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
        f.write(json.dumps(job) + "\n")

    log("INFO", "api", f"Job submitted: {job_type}")
    return job