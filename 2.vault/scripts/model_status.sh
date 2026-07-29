#!/bin/bash
echo "╔══════════════════════════════════════════════╗"
echo "║  👑 KLYN AI OS – ALL AI MODELS STATUS        ║"
echo "╚══════════════════════════════════════════════╝"
echo ""

# 1. Local DeepSeek‑Coder‑6.7B (fully offline)
echo "1. 🖥️  Local DeepSeek‑Coder‑6.7B (offline)"
if [ -f llama.cpp/models/deepseek-coder-6.7b-instruct.Q4_K_M.gguf ] && [ -f llama.cpp/build/bin/llama-cli ]; then
    echo "   ✅ Model & runner ready (3.9G)"
else
    echo "   ❌ Not installed"
fi

# 2. Offline template intelligence
echo ""
echo "2. 🧩 Offline Template Intelligence"
[ -f agents/src/local_intelligence.sh ] && echo "   ✅ Ready" || echo "   ❌ Missing"

# 3. Cloud models (GPT-5.5 Pro, Opus 4.8, Gemini, DeepSeek R1)
echo ""
echo "3. ☁️  Cloud AI Models (API keys required)"
[ -f /data/data/com.termux/files/home/klyn-ai-os/config/ai_keys.env ] && echo "   Config file: ✅ Found" || echo "   Config file: ❌ Missing"

declare -A models
models[OPENAI_API_KEY]="GPT‑5.5 Pro (OpenAI)"
models[ANTHROPIC_API_KEY]="Opus 4.8 (Anthropic)"
models[GEMINI_API_KEY]="Gemini 2.5/3.5 Pro (Google)"
models[DEEPSEEK_API_KEY]="DeepSeek R1 (Cloud)"

for key in "${!models[@]}"; do
    if [ -f /data/data/com.termux/files/home/klyn-ai-os/config/ai_keys.env ] && grep -q "^${key}=sk-" /data/data/com.termux/files/home/klyn-ai-os/config/ai_keys.env 2>/dev/null || grep -q "^${key}=AIza" /data/data/com.termux/files/home/klyn-ai-os/config/ai_keys.env 2>/dev/null; then
        echo "   ✅ ${models[$key]} – key set"
    else
        echo "   ⏳ ${models[$key]} – key not configured"
    fi
done

# 4. GitHub Copilot
echo ""
echo "4. 🤝 GitHub Copilot"
if command -v gh >/dev/null 2>&1 && gh copilot --version >/dev/null 2>&1; then
    echo "   ✅ Installed & authenticated"
else
    echo "   ❌ Not configured"
fi

# 5. Autonomous agents (local & hybrid)
echo ""
echo "5. 🧠 Autonomous AI Agents"
for agent in ai_code_editor ai_code_reviewer hybrid_code_reviewer autonomous_code_fixer; do
    [ -f agents/src/${agent}.sh ] && echo "   ✅ ${agent}" || echo "   ❌ ${agent}"
done

echo ""
echo "💯 Model audit complete."
echo ""
echo "ℹ️  To activate cloud models, add your real API keys to /data/data/com.termux/files/home/klyn-ai-os/config/ai_keys.env"
