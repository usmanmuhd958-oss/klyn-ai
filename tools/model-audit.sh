#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="${1:-$PWD}"

echo "===== KLYN MODEL AUDIT ====="
echo "Root: $ROOT"
echo

echo "=== AI Providers ==="
grep -RInE \
'OpenAI|GPT-5|GPT-5\.5|Anthropic|Claude|Opus|Gemini|DeepSeek' \
"$ROOT" 2>/dev/null | head -200

echo
echo "=== API Keys Referenced ==="
grep -RhoE \
'OPENAI_API_KEY|ANTHROPIC_API_KEY|GEMINI_API_KEY|DEEPSEEK_API_KEY' \
"$ROOT" 2>/dev/null | sort -u

echo
echo "=== Agent Files ==="
find "$ROOT" -type f \
\( -iname '*agent*.sh' \
-o -iname '*agent*.py' \
-o -iname '*agent*.js' \)

echo
echo "=== Agent Entrypoints ==="
grep -RInE \
'start_agent|run_agent|register_agent|agent_main|class .*Agent' \
"$ROOT" 2>/dev/null

echo
echo "===== DONE ====="
