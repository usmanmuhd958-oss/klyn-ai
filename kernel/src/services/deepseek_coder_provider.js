const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const PROJECT_ROOT = path.join(__dirname, '..', '..');
const LLAMA_PATH = path.join(PROJECT_ROOT, 'llama.cpp', 'build', 'bin', 'main');
const MODEL_PATH = path.join(PROJECT_ROOT, 'llama.cpp', 'models', 'deepseek-coder-6.7b-instruct.Q4_K_M.gguf');

async function callDeepSeekCoder(prompt) {
  if (!fs.existsSync(MODEL_PATH)) {
    throw new Error('Model not found. Run the download script first.');
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
