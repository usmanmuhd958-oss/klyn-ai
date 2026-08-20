#!/data/data/com.termux/files/usr/bin/bash

set -e

echo "================================="
echo " KLYN TERMINAL WORKSPACE SETUP"
echo "================================="

echo "[1/4] Installing tools..."

pkg install -y \
tmux \
zoxide \
direnv \
lazygit

echo "[2/4] Adding shell integration..."

cat >> ~/.zshrc <<'EOF'

# KLYN Workspace
eval "$(zoxide init zsh)"
eval "$(direnv hook zsh)"

alias lg='lazygit'

EOF

echo "[3/4] Verification..."

tmux -V
zoxide --version
direnv version
lazygit --version

echo "[4/4] Complete"

echo "================================="
echo " WORKSPACE READY"
echo "================================="
