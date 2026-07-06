import asyncio

async def recover_once():
    # existing logic stays here
    return True


# ============================
# PUBLIC STABLE ENTRYPOINT
# ============================

def recover():
    """
    Synchronous wrapper for async recovery system.
    This is the ONLY function master.py should call.
    """
    try:
        return asyncio.run(recover_once())
    except RuntimeError:
        # handles "event loop already running"
        loop = asyncio.get_event_loop()
        return loop.run_until_complete(recover_once())
