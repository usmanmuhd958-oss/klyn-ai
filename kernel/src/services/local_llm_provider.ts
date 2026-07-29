const { spawn } = require('child_process');
const path = require('path');

const PROJECT_ROOT = path.join(__dirname, '..', '..');
const LLAMA_PATH = path.join(PROJECT_ROOT, 'llama.cpp', 'main');
const MODEL_PATH = path.join(PROJECT_ROOT, 'llama.cpp', 'models', 'tinyllama-1.1b-chat-v1.0.Q4_K_M.gguf');

async function callLocalLLM(prompt) {
  if (!require('fs').existsSync(MODEL_PATH)) {
    throw new Error(`Model not found at ${MODEL_PATH}. Please download it first.`);
  }
  return new Promise((resolve, reject) => {
    const llama = spawn(LLAMA_PATH, [
      '-m', MODEL_PATH,
      '--prompt', prompt,
      '--temp', '0.7',
      '--max-tokens', '500',
      '--no-display-prompt'
    ]);
    let result = '';
    llama.stdout.on('data', (data) => { result += (data as any).toString(); });
    llama.stderr.on('data', (data) => { console.error((data as any).toString()); });
    llama.on('close', (code) => {
      if (code === 0) resolve(result.trim());
      else reject(new Error(`llama exited with code ${code}`));
    });
  });
}

if (require.main === module) {
  const task = process.argv.slice(2).join(' ');
  callLocalLLM(`You are the coder agent. Task: ${task}. Provide a complete solution.`)
    .then(console.log)
    .catch(console.error);
}
module.exports = { callLocalLLM };


export {};
