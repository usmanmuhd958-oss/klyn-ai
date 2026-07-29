#!/usr/bin/env bash
# =============================================================================
# KLYN AI OS – Session Environment Loader (Safe for Sourcing)
# Usage: source tools/load_env.sh
# =============================================================================
# Intentionally NO "set -e" here – sourcing with -e would kill the parent shell.

ENV_FILE="$HOME/klyn-ai-os/.env"

if [ ! -f "$ENV_FILE" ]; then
    echo "⚠️  .env file not found at $ENV_FILE"
    echo "   Run 'bash tools/setup_env.sh' to create it."
    return 1
fi

# Temporarily auto-export everything, then restore normal behaviour
set -a
source "$ENV_FILE"
set +a

echo "✅ Environment variables loaded:"
echo "   🔐 GITLAB_ACCESS_TOKEN"
echo "   🔐 GH_PERSONAL_TOKEN"
echo "   🔐 JWT_SECRET"
echo "   🤖 OPENAI_API_KEY"
echo "   🤖 DEEPSEEK_API_KEY"
echo "   🤖 GEMINI_API_KEY"
echo "   🤖 CLAUDE_API_KEY"
echo "   🗄️  SUPABASE_URL"
echo ""
echo "   All values are hidden. Run 'printenv | grep <KEY>' to verify."
