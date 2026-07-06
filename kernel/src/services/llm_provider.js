async function callOpenAI(prompt) {
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not set');
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }]
    })
  });
  const data = await res.json();
  if (data.error) throw new Error(`OpenAI error: ${data.error.message}`);
  return data.choices[0].message.content;
}

async function bestEffortCall(prompt, preferredProvider) {
  const providers = {
    openai: callOpenAI,
    // other providers can be added similarly
  };
  const order = preferredProvider ? [preferredProvider] : Object.keys(providers);
  for (const provider of order) {
    try {
      console.error(`[INFO] Trying provider: ${provider}...`);
      const result = await providers[provider](prompt);
      console.error(`[INFO] ${provider} succeeded`);
      return result;
    } catch (e) {
      console.error(`[FAIL] ${provider}: ${e.message}`);
    }
  }
  throw new Error('All providers failed. Please set at least one API key.');
}

// CLI mode
if (require.main === module) {
  const agent = process.argv[2];
  const task = process.argv[3] || 'no task';
  const prompt = `You are the ${agent} agent. ${task}. Provide a complete solution.`;
  bestEffortCall(prompt)
    .then(result => {
      console.log(result);
      process.exit(0);
    })
    .catch(err => {
      console.error(err.message);
      process.exit(1);
    });
}
module.exports = { bestEffortCall };
