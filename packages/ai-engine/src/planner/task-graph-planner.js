import { TaskGraphPlannerError, } from "../types/task-graph.types.js";
export class TaskGraphPlanner {
    plan(request) {
        if (request.nodes.length === 0) {
            throw new TaskGraphPlannerError("TASK_GRAPH_EMPTY", "Task graph must contain at least one node");
        }
        const nodeIds = new Set();
        for (const node of request.nodes) {
            if (nodeIds.has(node.id)) {
                throw new TaskGraphPlannerError("TASK_GRAPH_DUPLICATE_NODE", `Duplicate task node: ${node.id}`);
            }
            nodeIds.add(node.id);
        }
        const edges = this.buildEdges(request.nodes, request.edges ?? []);
        const dependencyMap = this.buildDependencyMap(request.nodes, edges);
        this.detectCycles(request.nodes, dependencyMap.prerequisites);
        const executionOrder = this.topologicalSort(request.nodes, dependencyMap.dependents, dependencyMap.prerequisites);
        return Object.freeze({
            nodes: Object.freeze([...request.nodes]),
            edges: Object.freeze([...edges]),
            dependencyMap,
            executionOrder: Object.freeze(executionOrder),
        });
    }
    buildEdges(nodes, explicitEdges) {
        const nodeIds = new Set(nodes.map((node) => node.id));
        const edges = [];
        const edgeKeys = new Set();
        for (const node of nodes) {
            for (const dependency of node.dependencies) {
                this.assertNodeExists(dependency, nodeIds);
                this.assertNotSelfDependency(dependency, node.id);
                const edge = { from: dependency, to: node.id };
                const key = `${edge.from}\u0000${edge.to}`;
                if (!edgeKeys.has(key)) {
                    edgeKeys.add(key);
                    edges.push(edge);
                }
            }
        }
        for (const edge of explicitEdges) {
            this.assertNodeExists(edge.from, nodeIds);
            this.assertNodeExists(edge.to, nodeIds);
            this.assertNotSelfDependency(edge.from, edge.to);
            const key = `${edge.from}\u0000${edge.to}`;
            if (!edgeKeys.has(key)) {
                edgeKeys.add(key);
                edges.push(edge);
            }
        }
        return edges;
    }
    assertNodeExists(id, nodeIds) {
        if (!nodeIds.has(id)) {
            throw new TaskGraphPlannerError("TASK_GRAPH_MISSING_NODE", `Missing task node: ${id}`);
        }
    }
    assertNotSelfDependency(from, to) {
        if (from === to) {
            throw new TaskGraphPlannerError("TASK_GRAPH_SELF_CYCLE", `Task node depends on itself: ${from}`);
        }
    }
    buildDependencyMap(nodes, edges) {
        const prerequisites = new Map();
        const dependents = new Map();
        for (const node of nodes) {
            prerequisites.set(node.id, []);
            dependents.set(node.id, []);
        }
        for (const edge of edges) {
            prerequisites.get(edge.to)?.push(edge.from);
            dependents.get(edge.from)?.push(edge.to);
        }
        for (const values of prerequisites.values())
            values.sort();
        for (const values of dependents.values())
            values.sort();
        return {
            prerequisites: this.freezeMap(prerequisites),
            dependents: this.freezeMap(dependents),
        };
    }
    freezeMap(source) {
        const result = new Map();
        for (const [key, values] of source)
            result.set(key, Object.freeze([...values]));
        return result;
    }
    detectCycles(nodes, prerequisites) {
        const state = new Map();
        for (const node of nodes)
            state.set(node.id, 0);
        const visit = (id) => {
            const current = state.get(id);
            if (current === 1) {
                throw new TaskGraphPlannerError("TASK_GRAPH_CYCLE", `Cycle detected involving task node: ${id}`);
            }
            if (current === 2)
                return;
            state.set(id, 1);
            for (const dependency of prerequisites.get(id) ?? [])
                visit(dependency);
            state.set(id, 2);
        };
        for (const node of nodes)
            visit(node.id);
    }
    topologicalSort(nodes, dependents, prerequisites) {
        const inDegree = new Map();
        for (const node of nodes)
            inDegree.set(node.id, prerequisites.get(node.id)?.length ?? 0);
        const ready = nodes.map((node) => node.id).filter((id) => inDegree.get(id) === 0).sort();
        const order = [];
        while (ready.length > 0) {
            const current = ready.shift();
            if (current === undefined)
                break;
            order.push(current);
            for (const dependent of dependents.get(current) ?? []) {
                const nextDegree = (inDegree.get(dependent) ?? 0) - 1;
                inDegree.set(dependent, nextDegree);
                if (nextDegree === 0) {
                    ready.push(dependent);
                    ready.sort();
                }
            }
        }
        if (order.length !== nodes.length) {
            throw new TaskGraphPlannerError("TASK_GRAPH_CYCLE", "Task graph cannot be topologically ordered");
        }
        return order;
    }
}
//# sourceMappingURL=task-graph-planner.js.map