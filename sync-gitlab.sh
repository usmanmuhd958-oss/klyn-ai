#!/usr/bin/env bash

set -e

BRANCH=$(git rev-parse --abbrev-ref HEAD)

echo "🔄 Pushing changes from branch '$BRANCH' to GitLab..."

if git push gitlab "$BRANCH" --force-with-lease; then
    echo "✅ Successfully synced GitLab with GitHub!"
else
    echo "❌ Failed to push changes to GitLab."
    exit 1
fi
