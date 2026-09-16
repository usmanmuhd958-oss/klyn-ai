# ADR-001 Canonical Module Authority

Date:
2026-08-07

Decision:

KLYN uses one authority implementation per core capability.

Canonical modules:

- AgentRuntime
- AgentExecutor
- AIEngine
- WorkflowEngine
- MemoryEngine


Reason:

Multiple implementations create architectural drift,
inconsistent behavior and maintenance cost.


Rule:

New implementations require architecture approval.
