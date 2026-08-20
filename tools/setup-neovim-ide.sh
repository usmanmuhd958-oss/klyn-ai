#!/data/data/com.termux/files/usr/bin/bash

set -e

echo "================================="
echo " KLYN MOBILE NEOVIM IDE SETUP"
echo "================================="

NVIM_DIR="$HOME/.config/nvim"

mkdir -p "$NVIM_DIR"

echo "[1/4] Installing lazy.nvim..."

LAZY_PATH="$HOME/.local/share/nvim/lazy/lazy.nvim"

if [ ! -d "$LAZY_PATH" ]; then
  git clone https://github.com/folke/lazy.nvim.git \
  "$LAZY_PATH" \
  --filter=blob:none
else
  echo "lazy.nvim already installed"
fi


echo "[2/4] Installing development plugins..."

cat > "$NVIM_DIR/init.lua" <<'EOF'

vim.g.mapleader = " "

local lazypath = vim.fn.stdpath("data") .. "/lazy/lazy.nvim"
vim.opt.rtp:prepend(lazypath)

require("lazy").setup({

{
"nvim-telescope/telescope.nvim",
dependencies={"nvim-lua/plenary.nvim"},
},

{
"nvim-tree/nvim-tree.lua",
dependencies={"nvim-tree/nvim-web-devicons"},
},

{
"nvim-lualine/lualine.nvim",
},

{
"nvim-treesitter/nvim-treesitter",
build=":TSUpdate",
},

{
"catppuccin/nvim",
name="catppuccin",
},

{
"akinsho/toggleterm.nvim",
version="*",
config=true,
},

{
"williamboman/mason.nvim",
config=true,
},

{
"williamboman/mason-lspconfig.nvim",
dependencies={
"neovim/nvim-lspconfig",
},
},

})


vim.opt.number=true
vim.opt.relativenumber=true
vim.opt.termguicolors=true


require("lualine").setup()
require("nvim-tree").setup()


vim.keymap.set("n","<leader>e",
":NvimTreeToggle<CR>")

vim.keymap.set("n","<leader>f",
":Telescope find_files<CR>")

vim.keymap.set("n","<leader>t",
":ToggleTerm<CR>")


EOF


echo "[3/4] Syncing plugins..."

nvim --headless "+Lazy sync" +qa


echo "[4/4] Complete"

echo "Neovim IDE foundation installed successfully."
