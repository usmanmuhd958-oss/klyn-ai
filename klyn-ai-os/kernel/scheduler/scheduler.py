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