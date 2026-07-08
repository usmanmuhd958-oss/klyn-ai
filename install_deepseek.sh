#!/bin/bash
set -e
cd ~/klyn-ai-os

echo "============================================"
echo " DeepSeek-Coder-6.7B Local AI Installation "
echo "============================================"

# Install tools (skip if already present)
pkg install -y cmake git build-essential wget || true

# Shallow clone llama.cpp (only the latest commit, much faster)
if [ ! -d llama.cpp ]; then
    echo "Cloning llama.cpp (shallow)..."
    git clone --depth 1 https://github.com/ggerganov/llama.cpp.git
fi
cd llama.cpp
make -j4
cd ..

# Download model with retries
MODEL_DIR="llama.cpp/models"
mkdir -p "$MODEL_DIR"
MODEL_FILE="deepseek-coder-6.7b-instruct.Q4_K_M.gguf"
MODEL_URL="https://huggingface.co/TheBloke/DeepSeek-Coder-6.7B-Instruct-GGUF/resolve/main/${MODEL_FILE}"

if [ ! -f "$MODEL_DIR/$MODEL_FILE" ]; then
    echo "Downloading DeepSeek-Coder-6.7B (~3.5GB) – may take a while..."
    # Retry up to 3 times if download fails
    for i in 1 2 3; do
        wget -c -P "$MODEL_DIR" "$MODEL_URL" && break
        echo "Download failed (attempt $i). Retrying..."
        sleep 5
    done
else
    echo "Model already downloaded."
fi

# Create the DeepSeek-Coder provider
cat > kernel/src/services/deepseek_coder_provider.js << 'PROVIDER'
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const PROJECT_ROOT = path.join(__dirname, '..', '..');
const LLAMA_PATH = path.join(PROJECT_ROOT, 'llama.cpp', 'main');
const MODEL_PATH = path.join(PROJECT_ROOT, 'llama.cpp', 'models', 'deepseek-coder-6.7b-instruct.Q4_K_M.gguf');

async function callDeepSeekCoder(prompt) {
  if (!fs.existsSync(MODEL_PATH)) {
    throw new Error('DeepSeek-Coder model not found. Run the installation script first.');
  }
  return new Promise((resolve, reject) => {
    const llama = spawn(LLAMA_PATH, [
      '-m', MODEL_PATH,
      '--prompt', `<|begin▁of▁sentence|>${prompt}<|end▁of▁sentence|>`,
      '--temp', '0.2',
      '--max-tokens', '1024',
      '--no-display-prompt'
    ]);
    let result = '';
    llama.stdout.on('data', (data) => { result += data.toString(); });
    llama.stderr.on('data', (data) => { console.error(data.toString()); });
    llama.on('close', (code) => {
      if (code === 0) resolve(result.trim());
      else reject(new Error(`llama exited with code ${code}`));
    });
  });
}

if (require.main === module) {
  const task = process.argv.slice(2).join(' ');
  callDeepSeekCoder(`You are the coder agent. Task: ${task}. Provide a complete solution.`)
    .then(console.log)
    .catch(console.error);
}
module.exports = { callDeepSeekCoder };
PROVIDER

# Update coder agent to use DeepSeek-Coder
cat > agents/src/coder.sh << 'AGENTEOF'
#!/bin/bash
PROJECT_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TASK="$*"
echo "[coder] Processing: $TASK"

# 1. Cloud AI first
if node "$PROJECT_ROOT/kernel/src/services/llm_provider.js" "coder" "$TASK" 2>/dev/null; then
    exit 0
fi

# 2. Local DeepSeek-Coder-6.7B
if [ -f "$PROJECT_ROOT/kernel/src/services/deepseek_coder_provider.js" ] && \
   [ -f "$PROJECT_ROOT/llama.cpp/models/deepseek-coder-6.7b-instruct.Q4_K_M.gguf" ]; then
    echo "[coder] Using local DeepSeek-Coder-6.7B..."
    node "$PROJECT_ROOT/kernel/src/services/deepseek_coder_provider.js" "$TASK" 2>/dev/null && exit 0
fi

# 3. General local LLM
if [ -f "$PROJECT_ROOT/kernel/src/services/local_llm_provider.js" ]; then
    echo "[coder] Using general local LLM..."
    node "$PROJECT_ROOT/kernel/src/services/local_llm_provider.js" "$TASK" 2>/dev/null && exit 0
fi

# 4. Offline templates
echo "[coder] Using offline templates..."
bash "$PROJECT_ROOT/agents/src/local_intelligence.sh" "$TASK"
AGENTEOF
chmod +x agents/src/coder.sh

echo ""
echo "✅ DeepSeek-Coder-6.7B installation complete!"
echo ""
echo "Test it with:"
echo "  node kernel/src/services/deepseek_coder_provider.js 'Write a Python function to merge two dicts'"
echo ""
echo "Or use the coder agent:"
echo "  ./bin/klyn agent coder 'Create a REST API in Node.js'"
