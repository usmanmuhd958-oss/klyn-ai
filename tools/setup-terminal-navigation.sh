#!/data/data/com.termux/files/usr/bin/bash

set -e

echo "================================="
echo " KLYN TERMINAL NAVIGATION SETUP"
echo "================================="

echo "[1/3] Installing tools..."

pkg install -y \
fzf \
bat \
eza

echo "[2/3] Creating aliases..."

cat >> ~/.zshrc <<'EOF'

# KLYN Navigation
alias ll='eza -la'
alias lt='eza --tree --level=2'
alias cat='bat'

export FZF_DEFAULT_COMMAND='fd --type f'

EOF

echo "[3/3] Done"

echo "================================="
echo " NAVIGATION READY"
echo "================================="
