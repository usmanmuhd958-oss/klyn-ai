const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', 'config', 'ai_keys.env') });

const providers = {
  openai: {
    keyEnv: 'OPENAI_API_KEY',
    endpoint: 'https://api.openai.com/v1/chat/completions',
    model: 'gpt-4o',
    buildBody: (prompt) => ({ model: 'gpt-4o', messages: [{ role: 'user', content: prompt }] }),
    parseResponse: (data) => data.choices[0].message.content
  },
  anthropic: {
    keyEnv: 'ANTHROPIC_API_KEY',
    endpoint: 'https://api.anthropic.com/v1/messages',
    model: 'claude-opus-4-20240229',
    buildBody: (prompt) => ({ model: 'claude-opus-4-20240229', max_tokens: 1024, messages: [{ role: 'user', content: prompt }] }),
    parseResponse: (data) => data.content[0].text
  },
  gemini: {
    keyEnv: 'GEMINI_API_KEY',
    endpoint: null,
    model: 'gemini-2.5-pro',
    buildUrl: (prompt) => `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key=${process.env.GEMINI_API_KEY}`,
    parseResponse: (data) => data.candidates[0].content.parts[0].text
  },
  deepseek: {
    keyEnv: 'DEEPSEEK_API_KEY',
    endpoint: 'https://api.deepseek.com/v1/chat/completions',
    model: 'deepseek-r1',
    buildBody: (prompt) => ({ model: 'deepseek-r1', messages: [{ role: 'user', content: prompt }] }),
    parseResponse: (data) => data.choices[0].message.content
  }
};

async function callProvider(name, prompt) {
  const p = providers[name];
  if (!p) throw new Error(`Unknown provider: ${name}`);
  if (!process.env[p.keyEnv]) throw new Error(`${p.keyEnv} not set`);

  if (p.endpoint) {
    const res = await fetch(p.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env[p.keyEnv]}`
      },
      body: JSON.stringify(p.buildBody(prompt))
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error.message);
    return p.parseResponse(data);
  } else {
    // Gemini uses different API
    const url = p.buildUrl(prompt);
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error.message);
    return p.parseResponse(data);
  }
}

async function bestEffortCall(prompt, preferredProvider) {
  const order = preferredProvider ? [preferredProvider, ...Object.keys(providers).filter(p => p !== preferredProvider)] : Object.keys(providers);
  for (const name of order) {
    try {
      return await callProvider(name, prompt);
    } catch (e) {
      console.error(`[${name}] failed: ${e.message}`);
    }
  }
  throw new Error('All AI providers failed');
}

if (require.main === module) {
  const agent = process.argv[2];
  const task = process.argv.slice(3).join(' ');
  const prompt = `You are the ${agent} agent in Klyn AI OS. Task: ${task}. Provide a complete solution.`;
  bestEffortCall(prompt)
    .then(r => { console.log(r); process.exit(0); })
    .catch(e => { console.error(e.message); process.exit(1); });
}

module.exports = { bestEffortCall };
