export class DependencyExecutionPlanner {
    async execute(tasks, options = {}) {
        const byId = new Map(tasks.map((task) => [task.id, task]));
        for (const task of tasks)
            for (const dependency of task.dependsOn ?? [])
                if (!byId.has(dependency))
                    throw new Error(`Unknown dependency ${dependency} for task ${task.id}`);
        const indegree = new Map();
        const children = new Map();
        for (const task of tasks) {
            indegree.set(task.id, task.dependsOn?.length ?? 0);
            children.set(task.id, []);
        }
        for (const task of tasks)
            for (const dependency of task.dependsOn ?? [])
                children.get(dependency).push(task.id);
        for (const list of children.values())
            list.sort();
        const ready = [...tasks].filter((task) => indegree.get(task.id) === 0).map((task) => task.id).sort();
        const status = new Map(tasks.map((task) => [task.id, "pending"]));
        const outputs = {};
        const completed = [], failed = [], skipped = [];
        const controller = new globalThis.AbortController();
        const onAbort = () => controller.abort(options.signal?.reason);
        if (options.signal?.aborted)
            onAbort();
        else
            options.signal?.addEventListener("abort", onAbort, { once: true });
        const limit = Number.isFinite(options.maxConcurrency) ? Math.max(1, Math.floor(options.maxConcurrency)) : Number.MAX_SAFE_INTEGER;
        const release = (id) => { for (const child of children.get(id)) {
            const next = indegree.get(child) - 1;
            indegree.set(child, next);
            if (next === 0) {
                ready.push(child);
                ready.sort();
            }
        } };
        const skipDescendants = (id) => { const queue = [...children.get(id)].sort(); while (queue.length) {
            const child = queue.shift();
            if (status.get(child) === "pending") {
                status.set(child, "skipped");
                skipped.push(child);
                queue.push(...children.get(child));
                queue.sort();
            }
        } };
        try {
            while (ready.length) {
                if (controller.signal.aborted)
                    throw new Error("Execution plan cancelled");
                const batch = ready.splice(0, limit);
                const results = await Promise.all(batch.map(async (id) => {
                    const task = byId.get(id);
                    if (!(task.dependsOn ?? []).every((dependency) => status.get(dependency) === "completed")) {
                        status.set(id, "skipped");
                        skipped.push(id);
                        skipDescendants(id);
                        return false;
                    }
                    status.set(id, "running");
                    try {
                        outputs[id] = await task.execute(controller.signal);
                        status.set(id, "completed");
                        completed.push(id);
                        release(id);
                        return true;
                    }
                    catch {
                        status.set(id, "failed");
                        failed.push(id);
                        skipDescendants(id);
                        return false;
                    }
                }));
                if (results.some((ok) => !ok))
                    return { completed, failed, skipped, outputs };
            }
            if (completed.length + failed.length + skipped.length !== tasks.length)
                throw new Error("Execution graph contains a cycle");
            return { completed, failed, skipped, outputs };
        }
        finally {
            options.signal?.removeEventListener("abort", onAbort);
        }
    }
}
//# sourceMappingURL=dependency-execution-planner.js.map