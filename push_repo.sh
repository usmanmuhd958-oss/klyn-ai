#!/usr/bin/env bash

echo "=========================================="
echo "       GIT REPOSITORY PUSH SCRIPT         "
echo "=========================================="
echo ""

# Ensure we are inside a git repository
if ! git rev-parse --is-inside-work-tree > /dev/null 2>&1; then
    echo "Error: Current directory is not a git repository."
    exit 1
fi

# Display working tree status
echo "--- Current Git Status ---"
git status -s
echo "--------------------------"
echo ""

# Stage changes
read -p "Do you want to stage all changes (git add .)? (y/n): " STAGE_CONFIRM
if [[ "$STAGE_CONFIRM" =~ ^[Yy]$ ]]; then
    git add .
    echo "Files staged successfully."
else
    echo "Skipping staging."
fi

# Commit message prompt
echo ""
read -p "Enter commit message: " COMMIT_MSG
if [ -z "$COMMIT_MSG" ]; then
    COMMIT_MSG="chore: update project source files"
    echo "No message entered. Using default: '$COMMIT_MSG'"
fi

# Create commit
git commit -m "$COMMIT_MSG" || echo "No changes to commit."

# Detect branch name
CURRENT_BRANCH=$(git branch --show-current 2>/dev/null)
if [ -z "$CURRENT_BRANCH" ]; then
    CURRENT_BRANCH="main"
fi

# Push confirmation
echo ""
read -p "Push to remote 'origin' on branch '$CURRENT_BRANCH'? (y/n): " PUSH_CONFIRM
if [[ "$PUSH_CONFIRM" =~ ^[Yy]$ ]]; then
    echo "Pushing changes to remote repository..."
    git push origin "$CURRENT_BRANCH"
    echo "Push completed successfully!"
else
    echo "Push cancelled."
fi
