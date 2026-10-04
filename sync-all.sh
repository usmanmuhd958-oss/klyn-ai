#!/usr/bin/env bash

set -e

BRANCH=$(git rev-parse --abbrev-ref HEAD)

echo "📥 Updating $BRANCH from GitHub (rebase)..."
git pull origin "$BRANCH" --rebase

echo "🚀 Pushing changes to GitHub..."
git push origin "$BRANCH"

echo "🚀 Syncing GitLab ($BRANCH)..."
git push gitlab "$BRANCH" --force-with-lease

echo "🎉 Done! GitHub and GitLab are synchronized."
