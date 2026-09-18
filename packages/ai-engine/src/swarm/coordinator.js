export class AgentSwarmCoordinator {
    router;
    options;
    constructor(router, options = {}) {
        this.router = router;
        this.options = options;
    }
    async run(tasks) {
        const concurrency = Math.max(1, Math.floor(this.options.concurrency ?? 4));
        const results = [];
        let cursor = 0;
        const worker = async () => {
            while (true) {
                const index = cursor++;
                const task = tasks[index];
                if (!task)
                    return;
                try {
                    const response = await this.router.generate({ system: `You are the ${task.role} agent in Klyn's execution swarm.`, input: task.instruction, maxOutputTokens: 4096 });
                    results[index] = { taskId: task.id, role: task.role, output: task.parse ? task.parse(response.output) : response.output };
                }
                catch (error) {
                    if (this.options.failFast !== false)
                        throw error;
                }
            }
        };
        await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, () => worker()));
        return results.filter((result) => result !== undefined);
    }
}
//# sourceMappingURL=coordinator.js.map