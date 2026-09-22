#!/usr/bin/env bash

set -e

echo "=== System Diagnostic & Automatic Fix ==="

if [ ! -d ".git" ]; then
    echo "Error: Not a git repository."
    exit 1
fi

CURRENT_BRANCH=$(git branch --show-current)
echo "Active Branch: $CURRENT_BRANCH"

echo "Reconciling dependencies..."
pnpm install --no-frozen-lockfile

echo "Staging changed manifests..."
git add package.json pnpm-lock.yaml pnpm-workspace.yaml || true
git add .

if git diff-index --quiet HEAD --; then
    echo "No workspace changes to commit."
else
    echo "Committing workspace reconciliation..."
    git commit -m "fix(deps): reconcile package.json with pnpm-lock.yaml"
    echo "Pushing changes to origin/$CURRENT_BRANCH..."
    git push origin "$CURRENT_BRANCH"
fi

echo "=== Process Complete ==="
