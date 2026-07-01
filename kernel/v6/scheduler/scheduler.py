import asyncio

def run_scheduler():
    """
    Compatibility wrapper for master.py.
    Runs async scheduler loop safely.
    """
    try:
        asyncio.run(scheduler_loop())
    except RuntimeError:
        # Handles case where event loop already exists
        loop = asyncio.get_event_loop()
        loop.run_until_complete(scheduler_loop())
