#!/bin/bash
echo "🧠 Adding AI brains to Klyn AI OS..."

# 1. Create a unified LLM provider (uses your existing ai-gateway or a simple Node script)
mkdir -p kernel/src/services
cat > kernel/src/services/llm_provider.js << 'PROVIDER'
const { execSync } = require('child_process');
// Simple wrapper to call external APIs (can be replaced with your ai-gateway package)
// This expects environment variables for each provider.

const providers = {
  openai: {
    call: async (prompt, model = 'gpt-5.5-pro') => {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}` },
        body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }] })
      });
      const data = await res.json();
      return data.choices[0].message.content;
    }
  },
  anthropic: {
    call: async (prompt, model = 'claude-opus-4-8') => {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model, max_tokens: 1024, messages: [{ role: 'user', content: prompt }] })
      });
      const data = await res.json();
      return data.content[0].text;
    }
  },
  gemini: {
    call: async (prompt, model = 'gemini-2.5-pro') => {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
      });
      const data = await res.json();
      return data.candidates[0].content.parts[0].text;
    }
  },
  deepseek: {
    call: async (prompt, model = 'deepseek-r1') => {
      const res = await fetch('https://api.deepseek.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}` },
        body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }] })
      });
      const data = await res.json();
      return data.choices[0].message.content;
    }
  }
};

// Try each provider in order until one succeeds
async function bestEffortCall(prompt, preferredProvider) {
  const order = preferredProvider ? [preferredProvider, ...Object.keys(providers).filter(p => p !== preferredProvider)] : Object.keys(providers);
  for (const provider of order) {
    try {
      return await providers[provider].call(prompt);
    } catch (e) {
      console.error(`Provider ${provider} failed: ${e.message}`);
    }
  }
  throw new Error('All AI providers failed.');
}

// CLI usage: node llm_provider.js <agent> <task> <optional: provider>
if (require.main === module) {
  const agent = process.argv[2];
  const task = process.argv[3];
  const provider = process.argv[4]; // optional
  const prompt = `You are the ${agent} agent in Klyn AI OS. Your task: ${task}. Provide a complete, production-ready solution.`;
  bestEffortCall(prompt, provider)
    .then(result => {
      console.log(result);
      process.exit(0);
    })
    .catch(err => {
      console.error(err);
      process.exit(1);
    });
}
module.exports = { bestEffortCall, providers };
PROVIDER

# 2. Update agent scripts to use the LLM
for agent in coder planner reviewer; do
    cat > agents/src/${agent}.sh << AGENTEOF
#!/bin/bash
PROJECT_ROOT="\$(cd "\$(dirname "\$0")/../.." && pwd)"
TASK="\$1"
if [ -z "\$TASK" ]; then
    echo "Usage: \$0 <task>"
    exit 1
fi
echo "[$agent] Processing task: \$TASK"
node "\$PROJECT_ROOT/kernel/src/services/llm_provider.js" "$agent" "\$TASK" 2>&1
AGENTEOF
    chmod +x agents/src/${agent}.sh
done

echo "✅ AI brains installed."
echo ""
echo "   Set your API keys in config/supabase.env or your shell:"
echo "   export OPENAI_API_KEY=sk-..."
echo "   export ANTHROPIC_API_KEY=..."
echo "   export GEMINI_API_KEY=..."
echo "   export DEEPSEEK_API_KEY=..."
echo ""
echo "   Then test: ./bin/klyn agent coder 'Write a Python script to clean my downloads folder'"
