#!/usr/bin/env bash

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}==============================================${NC}"
echo -e "${BLUE}        DEEPSEEK CODE CHANGES REPORT          ${NC}"
echo -e "${BLUE}==============================================${NC}\n"

# Verify inside git repository
if ! git rev-parse --is-inside-work-tree > /dev/null 2>&1; then
    echo -e "${RED}Error: Current directory is not a git repository.${NC}"
    exit 1
fi

# 1. New Untracked Files
echo -e "${GREEN}[+] NEWLY CREATED FILES (Built by AI):${NC}"
NEW_FILES=$(git ls-files --others --exclude-standard)

if [ -z "$NEW_FILES" ]; then
    echo "    (No new files created)"
else
    echo "$NEW_FILES" | sed 's/^/    - /'
fi

echo ""

# 2. Modified Existing Files
echo -e "${YELLOW}[~] MODIFIED FILES (Updated/Refactored):${NC}"
MODIFIED_FILES=$(git diff --name-only)

if [ -z "$MODIFIED_FILES" ]; then
    echo "    (No existing files modified)"
else
    echo "$MODIFIED_FILES" | sed 's/^/    - /'
fi

echo ""
echo -e "${BLUE}==============================================${NC}"

# Ask for Diffs
read -p "Do you want to see detailed code diffs? (y/N): " SHOW_DIFF
if [[ "$SHOW_DIFF" =~ ^[Yy]$ ]]; then
    echo -e "\n--- DETAILED CODE DIFFS ---"
    git diff
    echo -e "---------------------------\n"
fi

# Confirm Stage, Commit & Push
read -p "Do you want to stage, commit, and push these changes? (y/N): " CONFIRM
if [[ "$CONFIRM" =~ ^[Yy]$ ]]; then
    read -p "Enter commit message: " COMMIT_MSG
    
    if [ -z "$COMMIT_MSG" ]; then
        COMMIT_MSG="refactor: AI update and feature additions"
    fi

    CURRENT_BRANCH=$(git branch --show-current 2>/dev/null)
    if [ -z "$CURRENT_BRANCH" ]; then
        CURRENT_BRANCH="main"
    fi

    echo -e "\nStaging files..."
    git add .

    echo "Committing changes..."
    git commit -m "$COMMIT_MSG"

    echo "Pushing to remote ($CURRENT_BRANCH)..."
    git push origin "$CURRENT_BRANCH"

    echo -e "${GREEN}Successfully pushed to remote repository!${NC}"
else
    echo -e "${RED}Push cancelled. No changes were committed.${NC}"
fi
