import json
import sys
import time
import os

from kernel.v6.core.logger import logger

LEDGER = "runtime/ledger/jobs.jsonl"

VALID_TYPES = {"plan", "code", "review", "execute"}


def validate(job_type, payload):
    if job_type not in VALID_TYPES:
        raise ValueError("Invalid job type")
    if not isinstance(payload, str) or len(payload) == 0:
        raise ValueError("Invalid payload")


def submit(job_type, payload):
    validate(job_type, payload)

    job = {
        "id": str(time.time()),
        "type": job_type,
        "payload": payload,
        "status": "pending",
        "node": "local"
    }

    os.makedirs("runtime/ledger", exist_ok=True)

    with open(LEDGER, "a") as f:
        f.write(json.dumps(job) + "\n")

    logger._write("INFO", "api", f"Job submitted: {job_type}")


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python api.py <type> <payload>")
        sys.exit(1)

    submit(sys.argv[1], sys.argv[2])
