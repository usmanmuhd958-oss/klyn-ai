#!/data/data/com.termux/files/usr/bin/bash

set -e

echo "================================="
echo " KLYN NEOVIM COMPLETION ENGINE"
echo "================================="

NVIM_DIR="$HOME/.config/nvim"

echo "[1/3] Installing completion plugins..."

python3 - <<'PY'
from pathlib import Path

p = Path.home() / ".config/nvim/init.lua"

content = p.read_text()

insert = r'''

{
  "hrsh7th/nvim-cmp",
  dependencies = {
    "hrsh7th/cmp-nvim-lsp",
    "hrsh7th/cmp-buffer",
    "hrsh7th/cmp-path",
    "L3MON4D3/LuaSnip",
    "saadparwaiz1/cmp_luasnip",
  },
},

'''

if "hrsh7th/nvim-cmp" not in content:
    content = content.replace(
        "require(\"lazy\").setup({",
        "require(\"lazy\").setup({\n" + insert
    )
    p.write_text(content)

PY


echo "[2/3] Syncing plugins..."

nvim --headless "+Lazy sync" +qa


echo "[3/3] Complete"

echo "Completion engine installed."
