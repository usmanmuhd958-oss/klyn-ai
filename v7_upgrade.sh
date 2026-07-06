#!/usr/bin/env bash
set -e

echo "==> Creating new directory structure..."
mkdir -p kernel/src/{core,agents,services,syscall}
mkdir -p kernel/modules
mkdir -p agents/src
mkdir -p services/src
mkdir -p .cursor

# Move kernel core (choose best versions from v6)
echo "==> Moving kernel source..."
cp -n kernel/kernel.sh kernel/src/core/ 2>/dev/null || true
cp -n kernel/microkernel.sh kernel/src/core/ 2>/dev/null || true
cp -n kernel/event_bus.sh kernel/src/core/ 2>/dev/null || true
cp -n kernel/router.sh kernel/src/core/ 2>/dev/null || true
cp -n kernel/bus.sh kernel/src/core/ 2>/dev/null || true
cp -n kernel/scheduler.sh kernel/src/core/ 2>/dev/null || true
cp -n kernel/watchdog.sh kernel/src/core/ 2>/dev/null || true
cp -n kernel/daemon.sh kernel/src/core/ 2>/dev/null || true
cp -n kernel/health.sh kernel/src/core/ 2>/dev/null || true
cp -n kernel/recovery.sh kernel/src/core/ 2>/dev/null || true
cp -n kernel/worker.sh kernel/src/core/ 2>/dev/null || true
cp -n kernel/orchestrator.sh kernel/src/core/ 2>/dev/null || true
cp -n kernel/pipeline.sh kernel/src/core/ 2>/dev/null || true
cp -n kernel/queue.sh kernel/src/core/ 2>/dev/null || true
cp -n kernel/state.sh kernel/src/core/ 2>/dev/null || true

# Agent runtime
cp -n kernel/agent_runtime.sh kernel/src/agents/ 2>/dev/null || true
cp -n kernel/agents/* kernel/src/agents/ 2>/dev/null || true

# Syscall API
cp -n kernel/api/syscall.sh kernel/src/syscall/ 2>/dev/null || true

# Built-in services
cp -n kernel/services/* kernel/src/services/ 2>/dev/null || true
cp -n kernel/observability kernel/src/services/ 2>/dev/null || true
cp -n kernel/telemetry kernel/src/services/ 2>/dev/null || true
cp -n kernel/discovery kernel/src/services/ 2>/dev/null || true

# Plugin example
cp -n kernel/modules/example.plugin.sh kernel/modules/ 2>/dev/null || true

# Move high-level agents
cp -n agents/coder.sh agents/src/ 2>/dev/null || true
cp -n agents/planner.sh agents/src/ 2>/dev/null || true
cp -n agents/reviewer.sh agents/src/ 2>/dev/null || true
cp -n agents/executor.sh agents/src/ 2>/dev/null || true
cp -n agents/lib agents/src/ 2>/dev/null || true
cp -n agents/tools agents/src/ 2>/dev/null || true

# Move standalone services
cp -n services/ai-workers services/src/ 2>/dev/null || true
cp -n services/scheduler.json services/src/ 2>/dev/null || true

# Create .cursor rules file
cat > .cursor/rules << 'EOF'
You are working on Klyn AI OS, a distributed AI operating system in a monorepo.
Rules:
- All shell scripts must be POSIX‑compatible with bash extensions.
- Kernel components live in kernel/src/core/ and must have no side effects on load.
- State is stored only in runtime/.
- Use absolute paths relative to the project root: $PROJECT_ROOT.
- Write unit tests for all kernel services.
- Use `klyn` CLI for all user‑facing operations.
EOF

# Create .replit and replit.nix for Replit
cat > .replit << 'EOF'
language = "bash"
run = "bash boot.sh"
EOF

cat > replit.nix << 'NIXEOF'
{ pkgs }: {
  deps = [
    pkgs.bash
    pkgs.python311
    pkgs.nodejs_20
    pkgs.jq
    pkgs.curl
    pkgs.coreutils
  ];
  shell = "${pkgs.bash}/bin/bash";
}
NIXEOF

# Create a proper .gitignore (if not already)
cat > .gitignore << 'GITEOF'
node_modules/
runtime/
*.log
*.db
*.lock
*.pid
.DS_Store
GITEOF

echo "==> Done. New structure ready under kernel/src/, agents/src/, services/src/."
echo "    Next: remove old duplicate dirs (archive/, deprecated/, legacy/) after verifying everything works."
