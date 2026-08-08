# KLYN Module Authority Rules


## Rule 1 — Runtime

All agent execution must use:

packages/agent-runtime


Forbidden:

kernel/src/execution
archive-history
2.vault


---

## Rule 2 — Workflow

All workflows must use:

packages/workflow-engine


Forbidden:

kernel/workflow.ts


---

## Rule 3 — Memory

All memory operations must use:

intelligence/memory


Forbidden:

core/memory.ts


---

## Rule 4 — Gateway

All model routing must use:

packages/ai-gateway


---

## Rule 5 — No Duplicate Brain

Only one implementation of each core intelligence module is allowed.
