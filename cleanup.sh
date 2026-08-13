#!/usr/bin/env bash

REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null)
if [ -z "$REPO_ROOT" ]; then
    echo "❌ Error: Not inside a git repository."
    exit 1
fi
cd "$REPO_ROOT"

echo "🔄 Undoing last commit..."
git reset --soft HEAD~1 2>/dev/null || true

echo "📝 Writing .gitignore..."
cat << 'IGN' > .gitignore
*.log
klyn-runtime.log
backups/
bin/*.backup
dump_*.sh
node_modules/
dist/
.env
IGN

echo "🧹 Untracking cached log and backup files..."
git rm -r --cached backups/ klyn-runtime.log bin/*.backup dump_*.sh 2>/dev/null || true

echo "📦 Creating clean, modular commits..."
git add .gitignore && git commit -m "chore: update .gitignore rules" || true
[ -d genesis ] && git add genesis/ && git commit -m "feat(kernel): add v670 cognitive kernel modules" || true
[ -d tools ] && git add tools/ && git commit -m "feat(tools): add CLI tooling" || true
git add bootstrap_*.sh setup_*.sh 2>/dev/null && git commit -m "feat(bootstrap): add system bootstrap scripts" || true

echo "--------------------------------------------------"
echo "✅ Git cleanup complete! Current status:"
echo "--------------------------------------------------"
git status -s
