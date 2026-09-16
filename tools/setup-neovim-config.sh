#!/data/data/com.termux/files/usr/bin/bash

set -e

echo "================================="
echo " KLYN NEOVIM CONFIG GENERATOR"
echo "================================="

NVIM_DIR="$HOME/.config/nvim"

echo "[1/5] Creating directories..."

mkdir -p "$NVIM_DIR/lua/klyn"

echo "[2/5] Writing init.lua..."

cat > "$NVIM_DIR/init.lua" <<'EOF'
vim.g.mapleader = " "

local lazypath = vim.fn.stdpath("data") .. "/lazy/lazy.nvim"

if not vim.loop.fs_stat(lazypath) then
  vim.fn.system({
    "git",
    "clone",
    "--filter=blob:none",
    "https://github.com/folke/lazy.nvim.git",
    lazypath
  })
end

vim.opt.rtp:prepend(lazypath)

require("lazy").setup({

{
 "nvim-telescope/telescope.nvim",
 dependencies = {"nvim-lua/plenary.nvim"},
},

{
 "nvim-tree/nvim-tree.lua",
 dependencies = {"nvim-tree/nvim-web-devicons"},
},

{
 "nvim-lualine/lualine.nvim",
},

{
 "nvim-treesitter/nvim-treesitter",
 build = ":TSUpdate",
},

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

{
 "williamboman/mason.nvim",
},

{
 "williamboman/mason-lspconfig.nvim",
},

{
 "neovim/nvim-lspconfig",
},

{
 "catppuccin/nvim",
 name="catppuccin",
}

})

vim.opt.number = true
vim.opt.relativenumber = true
vim.opt.termguicolors = true

vim.cmd.colorscheme("catppuccin")

require("klyn.lsp")
require("klyn.cmp")

require("lualine").setup()
require("nvim-tree").setup()
EOF


echo "[3/5] Writing LSP config..."

cat > "$NVIM_DIR/lua/klyn/lsp.lua" <<'EOF'
local capabilities = require("cmp_nvim_lsp").default_capabilities()

vim.lsp.config("ts_ls", {
 capabilities = capabilities,
})

vim.lsp.config("pyright", {
 capabilities = capabilities,
})

vim.lsp.config("bashls", {
 capabilities = capabilities,
})

vim.lsp.config("yamlls", {
 capabilities = capabilities,
})

vim.lsp.enable({
 "ts_ls",
 "pyright",
 "bashls",
 "yamlls",
})
EOF


echo "[4/5] Writing completion config..."

cat > "$NVIM_DIR/lua/klyn/cmp.lua" <<'EOF'
local cmp = require("cmp")

cmp.setup({

snippet = {
 expand = function(args)
  require("luasnip").lsp_expand(args.body)
 end,
},

mapping = cmp.mapping.preset.insert({

['<C-Space>'] = cmp.mapping.complete(),

['<CR>'] = cmp.mapping.confirm({
 select=true
}),

}),

sources = cmp.config.sources({

{
 name="nvim_lsp"
},

{
 name="path"
},

{
 name="buffer"
}

})

})
EOF


echo "[5/5] Complete"

echo "================================="
echo " KLYN NEOVIM IDE CONFIG READY"
echo "================================="
