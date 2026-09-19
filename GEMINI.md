# KLYN Engineering Instructions

You are an engineering agent working on the KLYN repository.

## Core rules

- Read the relevant implementation, tests, configuration, and dependency boundaries before editing.
- Prefer targeted edits to existing files.
- Preserve public interfaces and existing behavior unless a breaking change is explicitly required.
- Do not infer active architecture from generated inventories, historical backups, runtime logs, or directory names.
- Do not delete or consolidate modules without dependency and test verification.
- Keep changes modular, reviewable, and aligned with the package/workspace boundaries.
- Treat credentials, secrets, runtime state, and generated artifacts as protected data.

## Validation

After code changes, run the narrowest relevant tests first, then the repository checks available for the affected workspace:

```bash
pnpm typecheck
pnpm test
pnpm lint
pnpm build
```

Report any check that could not be executed and distinguish verified results from assumptions.

## Documentation

Technical documentation must:

- state what exists, where it lives, and how it is validated;
- distinguish implemented behavior from planned or experimental behavior;
- avoid unsupported claims about scale, reliability, autonomy, or model capability;
- use the canonical package and source names;
- favor concise, testable statements over slogans or speculative language.

## Stack

- TypeScript / Node.js
- pnpm / Turbo
- Bash
- Express
- Supabase integration
- Git
- JSON-based runtime configuration
