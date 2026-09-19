# KLYN Dependency Audit

**Scope:** repository architecture and dependency integrity.

## Objective

Classify modules as:

- canonical implementation;
- duplicate or superseded implementation;
- experimental or research-only module;
- generated artifact;
- runtime state or operational output;
- unused or unreferenced code.

## Evidence standard

A module is canonical only when repository evidence supports its role. Prefer:

1. workspace membership;
2. package dependency edges;
3. source imports and exports;
4. executable scripts and runtime registration;
5. tests and validation coverage;
6. deployment or generation references.

Directory naming, version labels, and documentation claims are insufficient on their own.

## Non-deletion rule

No implementation is deleted, merged, or renamed without dependency verification.

Before removal, confirm:

- owner or replacement module;
- import and export paths;
- package dependency impact;
- scripts and generation references;
- tests covering the affected behavior;
- runtime or deployment references;
- migration or rollback requirements.

## Audit output

Each finding should record:

- path;
- classification;
- evidence;
- consumers;
- test coverage;
- recommended action;
- confidence and unresolved questions.

The purpose of this audit is to reduce architectural ambiguity without destroying working or historically significant evidence.
