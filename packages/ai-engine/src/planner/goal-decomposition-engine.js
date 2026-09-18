import { GoalDecomposerError } from "../types/goal-decomposition.types.js";
const MAX_GOAL_LENGTH = 10_000;
const MAX_TASK_LENGTH = 2_000;
const DEFAULT_AGENT_TYPE = "general";
export class GoalDecompositionEngine {
    decompose(request) {
        if (request === null || typeof request !== "object" || typeof request.goal !== "string") {
            throw new GoalDecomposerError("GOAL_INVALID_TYPE", "Goal must be a string.");
        }
        const normalizedGoal = this.normalizeGoal(request.goal);
        if (normalizedGoal.length === 0) {
            throw new GoalDecomposerError("GOAL_EMPTY", "Goal must contain non-whitespace text.");
        }
        if (normalizedGoal.length > MAX_GOAL_LENGTH) {
            throw new GoalDecomposerError("GOAL_TOO_LONG", "Goal exceeds the maximum supported length.");
        }
        const fragments = this.extractTaskFragments(normalizedGoal);
        if (fragments.length === 0) {
            throw new GoalDecomposerError("GOAL_NO_TASKS", "Goal did not produce any executable task fragments.");
        }
        const agentType = this.normalizeAgentType(request.agentType);
        const constraints = this.normalizeConstraints(request.constraints);
        const metadata = request.metadata === undefined ? undefined : Object.freeze({ ...request.metadata });
        const nodes = fragments.map((fragment, index) => {
            if (fragment.length > MAX_TASK_LENGTH) {
                throw new GoalDecomposerError("GOAL_TASK_TOO_LONG", `Task ${index + 1} exceeds the maximum supported length.`);
            }
            const id = `goal-task-${String(index + 1).padStart(3, "0")}`;
            const dependencies = index === 0 ? [] : [`goal-task-${String(index).padStart(3, "0")}`];
            return Object.freeze({
                id,
                title: this.toTitle(fragment, index),
                description: fragment,
                agentType,
                dependencies: Object.freeze(dependencies),
                constraints,
                metadata,
                sequence: index + 1,
            });
        });
        const edges = Object.freeze(nodes.slice(1).map((node) => Object.freeze({ from: node.dependencies[0], to: node.id })));
        const planRequest = Object.freeze({
            goal: normalizedGoal,
            nodes: Object.freeze(nodes),
            edges,
            constraints,
        });
        return Object.freeze({
            normalizedGoal,
            nodes: Object.freeze(nodes),
            planRequest,
        });
    }
    normalizeGoal(goal) {
        return goal.replace(/\s+/g, " ").trim();
    }
    normalizeAgentType(agentType) {
        const normalized = agentType?.replace(/\s+/g, " ").trim();
        return normalized === undefined || normalized.length === 0 ? DEFAULT_AGENT_TYPE : normalized;
    }
    normalizeConstraints(constraints) {
        if (constraints === undefined) {
            return Object.freeze([]);
        }
        return Object.freeze(constraints.map((constraint) => Object.freeze({
            type: constraint.type.trim(),
            ...(constraint.value === undefined ? {} : { value: constraint.value }),
            ...(constraint.description === undefined ? {} : { description: constraint.description.trim() }),
        })));
    }
    extractTaskFragments(goal) {
        const structured = goal
            .split(/(?:^|\s)(?:\d+[.)]|[-*•])\s+/g)
            .map((fragment) => fragment.trim())
            .filter((fragment) => fragment.length > 0);
        if (structured.length > 1) {
            return structured.map((fragment) => this.cleanFragment(fragment));
        }
        const semicolonFragments = goal.split(/\s*;\s*/).map((fragment) => fragment.trim()).filter(Boolean);
        if (semicolonFragments.length > 1) {
            return semicolonFragments.map((fragment) => this.cleanFragment(fragment));
        }
        const sentenceFragments = goal.split(/(?<=[.!?])\s+/).map((fragment) => fragment.trim()).filter(Boolean);
        if (sentenceFragments.length > 1) {
            return sentenceFragments.map((fragment) => this.cleanFragment(fragment));
        }
        const orderedFragments = goal.split(/\s+(?:and then|then|followed by)\s+/i).map((fragment) => fragment.trim()).filter(Boolean);
        if (orderedFragments.length > 1) {
            return orderedFragments.map((fragment) => this.cleanFragment(fragment));
        }
        return [this.cleanFragment(goal)];
    }
    cleanFragment(fragment) {
        return fragment.replace(/^[\s.:;-]+|[\s.:;-]+$/g, "").replace(/\s+/g, " ").trim();
    }
    toTitle(fragment, index) {
        const normalized = fragment.charAt(0).toUpperCase() + fragment.slice(1);
        return normalized.length === 0 ? `Task ${index + 1}` : normalized;
    }
}
//# sourceMappingURL=goal-decomposition-engine.js.map