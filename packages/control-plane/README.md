# @klyn/control-plane

KLYN's deterministic backend control-plane kernel. This package implements:

1. immutable cryptographic mission ledger and anomaly detection;
2. resource and permission envelopes with hard caps;
3. heterogeneous worker admission and scheduling;
4. DAG-based context locality and compression;
5. verifiable eight-state mission FSM with fail-closed guards;
6. container/MicroVM lifecycle policy;
7. Merkle checkpointing and black-box execution traces.

The in-memory store is a deterministic reference implementation for tests. Production deployments should bind `MissionLedgerStore` to PostgreSQL using the transaction boundary defined by `sql/001_control_plane.sql`.

Credential metadata stores only token hashes; raw credential material is not persisted by the broker. Credential grants are execution-bound, scope-bound, audience-bound, and capped at 900 seconds.
