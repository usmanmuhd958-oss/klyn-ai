
import asyncio
from kernel.v6.scheduler.scheduler import run_scheduler
from kernel.v6.cluster.node_daemon import node_loop
from kernel.v6.recovery.recovery import recover

async def main():
    print("[MASTER] booting KLYN OS v6 kernel")

    recover()

    await asyncio.gather(
        run_scheduler(),
        node_loop()
    )

if __name__ == "__main__":
    asyncio.run(main())
