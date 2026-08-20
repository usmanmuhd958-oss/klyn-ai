#!/data/data/com.termux/files/usr/bin/bash

set -e

echo "================================="
echo " KLYN LSP SERVER INSTALLER"
echo "================================="

echo "[1/5] Installing Node global tools..."

npm install -g \
typescript \
typescript-language-server


echo "[2/5] Installing Python language server..."

pip install --upgrade pyright


echo "[3/5] Installing Bash language server..."

npm install -g \
bash-language-server


echo "[4/5] Installing YAML + JSON language servers..."

npm install -g \
yaml-language-server \
vscode-json-languageserver


echo "[5/5] Verification..."

echo ""
echo "TypeScript:"
typescript-language-server --version || true

echo ""
echo "Python:"
pyright --version || true

echo ""
echo "Bash:"
bash-language-server --version || true

echo ""
echo "================================="
echo " KLYN LSP SERVERS READY"
echo "================================="
