import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const PROJECT_ROOT = (process.env.KLYN_PROJECT_ROOT || path.join(process.env.HOME || '', 'klyn-ai-os'));
const LLAMA_PATH = path.join(PROJECT_ROOT, 'llama.cpp', 'build', 'bin', 'llama-cli');
const MODEL_PATH = path.join(PROJECT_ROOT, 'llama.cpp', 'models', 'deepseek-coder-6.7b-instruct.Q4_K_M.gguf');

async function callDeepSeekCoder(prompt) {
  if (!fs.existsSync(LLAMA_PATH)) {
    throw new Error(`llama-cli binary not found at ${LLAMA_PATH}`);
  }
  if (!fs.existsSync(MODEL_PATH)) {
    throw new Error(`Model not found at ${MODEL_PATH}`);
  }
  return new Promise((resolve, reject) => {
    const llama = spawn(LLAMA_PATH, [
      '-m', MODEL_PATH,
      '-p', `<|begin▁of▁sentence|>${prompt}<|end▁of▁sentence|>`,
      '--temp', '0.2',
      '-n', '1024'
    ]);
    let result = '';
    llama.stdout.on('data', (data) => { result += (data as any).toString(); });
    llama.stderr.on('data', (data) => { console.error((data as any).toString()); });
    llama.on('close', (code) => {
      if (code === 0) resolve(result.trim());
      else reject(new Error(`llama-cli exited with code ${code}`));
    });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const task = process.argv.slice(2).join(' ');
  callDeepSeekCoder(`You are the coder agent. Task: ${task}. Provide a complete solution.`)
    .then(console.log)
    .catch(console.error);
}
export { callDeepSeekCoder };


export {};
