#!/usr/bin/env bash
set -Eeuo pipefail

CONTEXT_DIR="runtime/context"

index_project() {
    mkdir -p "$CONTEXT_DIR"

    find . \
        -type f \
        ! -path './runtime/*' \
        ! -path './.git/*' \
        > "$CONTEXT_DIR/files.index"

    find . \
        -type f \
        \( -name '*.sh' -o -name '*.py' -o -name '*.js' \) \
        > "$CONTEXT_DIR/code.index"
}

project_stats() {
    echo "Files: $(wc -l < "$CONTEXT_DIR/files.index")"
    echo "Code:  $(wc -l < "$CONTEXT_DIR/code.index")"
}
