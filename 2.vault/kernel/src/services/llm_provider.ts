// [KLYN-AST-GUARD] Verified & Protected by Klyn OS Kernel
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const MODELS = {
  openai:   { env: 'OPENAI_API_KEY',    name: 'gpt-5.5-pro',          endpoint: 'https://api.openai.com/v1/chat/completions',      authHeader: (k) => `Bearer ${k}` },
  anthropic:{ env: 'ANTHROPIC_API_KEY',  name: 'claude-opus-4-8-20260201', endpoint: 'https://api.anthropic.com/v1/messages',      authHeader: (k) => `x-api-key: ${k}` },
  gemini:   { env: 'GEMINI_API_KEY',     name: 'gemini-3.5-pro',      endpoint: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-pro:generateContent' },
  deepseek: { env: 'DEEPSEEK_API_KEY',   name: 'deepseek-r1',         endpoint: 'https://api.deepseek.com/v1/chat/completions',   authHeader: (k) => `Bearer ${k}` }
};

function loadKeys() {
  const envFile = path.join(__dirname, '..', '..', 'config', 'ai_keys.env');
  if (fs.existsSync(envFile)) {
    const lines = fs.readFileSync(envFile, 'utf8').split('\n');
    lines.forEach(line => {
      const [key, ...rest] = line.split('=');
      if (key && rest.length) process.env[key.trim()] = rest.join('=').trim();
    });
  }
}

async function callProvider(provider, prompt) {
  const model = MODELS[provider];
  if (!model) throw new Error(`Unknown provider: ${provider}`);
  const apiKey = process.env[model.env];
  if (!apiKey) throw new Error(`${model.env} not set`);

  if (provider === 'gemini') {
    const url = `${model.endpoint}?key=${apiKey}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
    });
    const data = await (res as any).json();
    if ((data as any).error) throw new Error((data as any).error.message);
    return (data as any).candidates[0].content.parts[0].text;
  }

  const body = provider === 'anthropic'
    ? JSON.stringify({ model: model.name, max_tokens: 1024, messages: [{ role: 'user', content: prompt }] })
    : JSON.stringify({ model: model.name, messages: [{ role: 'user', content: prompt }] });

  const res = await fetch(model.endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': model.authHeader(apiKey)
    },
    body
  });
  const data = await (res as any).json();
  if ((data as any).error) throw new Error((data as any).error.message);
  return provider === 'anthropic' ? (data as any).content[0].text : (data as any).choices[0].message.content;
}

async function bestEffortCall(prompt, preferredProvider) {
  loadKeys();
  const order = preferredProvider ? [preferredProvider, ...Object.keys(MODELS).filter(p => p !== preferredProvider)] : Object.keys(MODELS);
  for (const provider of order) {
    try {
      return await callProvider(provider, prompt);
    } catch(e) {
      console.error(`[${provider}] ${e.message}`);
    }
  }
  throw new Error('All providers failed');
}

// CLI test: node llm_provider.js "Your prompt" [provider]
if (require.main === module) {
  const task = process.argv.slice(2).join(' ');
  const preferred = process.argv[2] && Object.keys(MODELS).includes(process.argv[2]) ? process.argv[2] : null;
  bestEffortCall(task, preferred)
    .then(console.log)
    .catch(console.error);
}
module.exports = { bestEffortCall, MODELS };


export {};
