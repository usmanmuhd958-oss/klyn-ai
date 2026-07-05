#!/bin/bash
echo "===== KLYN AI Project Stats ====="
echo "Size: $(du -sh . | cut -f1)"
echo "Files: $(find . -type f | wc -l)"
echo "Folders: $(find . -type d | wc -l)"
echo "Branch: $(git branch --show-current)"
echo "Commits: $(git rev-list --count HEAD)"
echo "Last Commit: $(git log -1 --pretty=%h)"
echo "================================"
