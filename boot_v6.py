import asyncio
import signal

from kernel.v6.core.logger import logger
from kernel.v6.scheduler.scheduler import scheduler_loop
from kernel.v6.cluster.node_daemon import node_loop
from kernel.v6.recovery.recovery import recovery_loop

STOP = False


def stop_handler(*_):
    global STOP
    STOP = True
    logger._write("WARN", "boot", "Shutdown signal received")


async def main():
    logger._write("INFO", "boot", "KLYN OS v6 Microkernel starting")

    # recovery first
    await recovery_loop_once()

    tasks = [
        asyncio.create_task(scheduler_loop()),
        asyncio.create_task(node_loop()),
    ]

    while not STOP:
        await asyncio.sleep(0.5)

    logger._write("WARN", "boot", "Stopping system...")

    for t in tasks:
        t.cancel()


async def recovery_loop_once():
    from kernel.v6.recovery.recovery import recover_once
    await recover_once()


if __name__ == "__main__":
    signal.signal(signal.SIGINT, stop_handler)
    signal.signal(signal.SIGTERM, stop_handler)

    asyncio.run(main())
