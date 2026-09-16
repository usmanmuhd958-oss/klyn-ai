#!/data/data/com.termux/files/usr/bin/bash

set -e

echo "================================="
echo " KLYN GIT WORKFLOW SETUP"
echo "================================="

echo "[1/4] Git version..."
git --version

echo "[2/4] Configuring useful defaults..."

git config --global init.defaultBranch main
git config --global pull.rebase false
git config --global core.editor nvim

echo "[3/4] Git aliases..."

git config --global alias.st status
git config --global alias.co checkout
git config --global alias.br branch
git config --global alias.cm commit
git config --global alias.lg "log --oneline --graph --decorate"

echo "[4/4] Verification..."

git config --global --list | grep alias

echo "================================="
echo " GIT WORKFLOW READY"
echo "================================="
