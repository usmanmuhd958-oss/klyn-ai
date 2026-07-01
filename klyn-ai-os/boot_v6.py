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