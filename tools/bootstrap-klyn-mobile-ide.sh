#!/data/data/com.termux/files/usr/bin/bash

set -e

echo "================================="
echo " KLYN MOBILE IDE BOOTSTRAP"
echo "================================="

ROOT="$HOME/klyn-ai-os"

echo "[1/5] Updating packages..."
pkg update -y
pkg upgrade -y

echo "[2/5] Installing development tools..."
pkg install -y \
git \
nodejs \
python \
neovim \
ripgrep \
fd \
curl \
wget \
openssh \
tree

echo "[3/5] Installing npm tools..."
npm install -g \
typescript \
typescript-language-server \
bash-language-server

echo "[4/5] Installing python tools..."
pip install pyright

echo "[5/5] Verification..."

echo "Node:"
node -v

echo "Python:"
python --version

echo "Neovim:"
nvim --version | head -n 2

echo "================================="
echo " KLYN MOBILE IDE READY"
echo "================================="
