#!/usr/bin/env bash

# ==============================================================================
# KLYN AI OS - Automated TypeScript Error Patching Script
# Targets: ast_graph.ts, swarm_mesh.ts, swarm_dashboard.ts
# ==============================================================================

set -euo pipefail

# ANSI Color Codes
readonly GREEN='\033[0;32m'
readonly BLUE='\033[0;34m'
readonly YELLOW='\033[1;33m'
readonly RED='\033[0;31m'
readonly NC='\033[0m'

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

patch_files() {
    log_info "Applying automated code patches..."

    node -e '
    const fs = require("fs");

    // Fix 1: tools/swarm_dashboard.ts (Module default import issue)
    const dashPath = "tools/swarm_dashboard.ts";
    if (fs.existsSync(dashPath)) {
        let content = fs.readFileSync(dashPath, "utf8");
        content = content.replace(
            /import\s+process\s+from\s+[\x27"]node:process[\x27"];?/,
            "import * as process from \x27node:process\x27;"
        );
        fs.writeFileSync(dashPath, content, "utf8");
        console.log("-> Successfully patched tools/swarm_dashboard.ts");
    }

    // Fix 2: kernel/src/orchestrator/swarm_mesh.ts (Duplicate Logger class declaration conflict)
    const swarmPath = "kernel/src/orchestrator/swarm_mesh.ts";
    if (fs.existsSync(swarmPath)) {
        let content = fs.readFileSync(swarmPath, "utf8");
        content = content.replace(
            /import\s+\{\s*Logger\s*\}\s+from\s+[\x27"]\.\.\/logger[\x27"];?/,
            "import { Logger as SystemLogger } from \x27../logger\x27;"
        );
        fs.writeFileSync(swarmPath, content, "utf8");
        console.log("-> Successfully patched kernel/src/orchestrator/swarm_mesh.ts");
    }

    // Fix 3: kernel/src/indexer/ast_graph.ts (TS2339 property modifiers type casting)
    const astPath = "kernel/src/indexer/ast_graph.ts";
    if (fs.existsSync(astPath)) {
        let content = fs.readFileSync(astPath, "utf8");
        content = content.replace(/node\.modifiers/g, "(node as any).modifiers");
        fs.writeFileSync(astPath, content, "utf8");
        console.log("-> Successfully patched kernel/src/indexer/ast_graph.ts");
    }
    '
}

verify_compilation() {
    log_info "Verifying TypeScript compilation via tsc..."
    if npx tsc --noEmit; then
        echo ""
        log_success "All TypeScript errors resolved successfully! Clean build."
    else
        echo ""
        log_error "Some errors still remain. Review the output above."
        exit 1
    fi
}

main() {
    patch_files
    verify_compilation
}

main "$@"
