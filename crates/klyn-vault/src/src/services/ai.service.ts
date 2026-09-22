import { getSupabase } from '../lib/supabase.js';
import { withRetryAndCircuit } from '../../kernel/backoff.js';

export interface AIResponse {
  text: string;
  model: string;
  provider: string;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
  };
}

interface AIRequest {
  prompt: string;
  model?: string;
  organizationId?: string;
  userId?: string;
  provider?: string;
}

// All external provider calls share one resilience policy: jittered
// exponential backoff + circuit breaker via kernel/backoff.ts. 4xx client
// errors are never retried (they only burn quota); 429/5xx and network errors
// retry with backoff. Each provider gets its own circuit so one degraded
// upstream cannot trip the others.
const AI_RETRY = { maxAttempts: 3, baseMs: 200, maxMs: 2_000 };

async function fetchJson(url: string, init: RequestInit, circuit: string): Promise<any> {
  return withRetryAndCircuit(
    circuit,
    async () => {
      const res = await fetch(url, init);
      if (!res.ok) {
        const err: any = new Error(`HTTP ${res.status} ${res.statusText} from ${url}`);
        err.statusCode = res.status;
        err.retryable = res.status === 429 || res.status >= 500;
        throw err;
      }
      return res.json();
    },
    AI_RETRY
  );
}

async function callAnthropic(prompt: string): Promise<AIResponse> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set');
  const data = await fetchJson(
    'https://api.anthropic.com/v1/messages',
    {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 4096,
        messages: [{ role: 'user', content: prompt }],
      }),
    },
    'ai:anthropic'
  );
  const text = data?.content?.[0]?.text || '';
  return {
    text,
    model: 'claude-sonnet-4-5',
    provider: 'anthropic',
    usage: {
      prompt_tokens: data?.usage?.input_tokens ?? prompt.length,
      completion_tokens: data?.usage?.output_tokens ?? text.length,
    },
  };
}

async function callOpenAI(prompt: string): Promise<AIResponse> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is not set');
  const data = await fetchJson(
    'https://api.openai.com/v1/chat/completions',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: prompt }],
      }),
    },
    'ai:openai'
  );
  const text = data?.choices?.[0]?.message?.content || '';
  return {
    text,
    model: 'gpt-4o',
    provider: 'openai',
    usage: {
      prompt_tokens: data?.usage?.prompt_tokens ?? prompt.length,
      completion_tokens: data?.usage?.completion_tokens ?? text.length,
    },
  };
}

async function callGemini(prompt: string): Promise<AIResponse> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key=${apiKey}`;
  const data = await fetchJson(
    url,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
      }),
    },
    'ai:gemini'
  );
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  return {
    text,
    model: 'gemini-2.5-pro',
    provider: 'gemini',
    usage: {
      prompt_tokens: data?.usageMetadata?.promptTokenCount ?? prompt.length,
      completion_tokens: data?.usageMetadata?.candidatesTokenCount ?? text.length,
    },
  };
}

async function callDeepSeek(prompt: string): Promise<AIResponse> {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error('DEEPSEEK_API_KEY is not set');
  const data = await fetchJson(
    'https://api.deepseek.com/chat/completions',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [{ role: 'user', content: prompt }],
      }),
    },
    'ai:deepseek'
  );
  const text = data?.choices?.[0]?.message?.content || '';
  return {
    text,
    model: 'deepseek-chat',
    provider: 'deepseek',
    usage: {
      prompt_tokens: data?.usage?.prompt_tokens ?? prompt.length,
      completion_tokens: data?.usage?.completion_tokens ?? text.length,
    },
  };
}

async function callOllama(prompt: string, model?: string): Promise<AIResponse> {
  const host = process.env.OLLAMA_HOST || 'http://localhost:11434';
  const usedModel = model || 'llama3.2';
  const data = await fetchJson(
    `${host}/api/generate`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: usedModel,
        prompt,
        stream: false,
      }),
    },
    'ai:ollama'
  );
  const text = data?.response || '';
  return {
    text,
    model: usedModel,
    provider: 'ollama',
    usage: {
      prompt_tokens: prompt.length,
      completion_tokens: text.length,
    },
  };
}

export async function callAI(request: AIRequest): Promise<AIResponse> {
  const { prompt, model, organizationId, userId, provider } = request;
  const selectedProvider = provider || process.env.AI_PROVIDER || 'anthropic';

  let response: AIResponse;

  switch (selectedProvider) {
    case 'anthropic':
      response = await callAnthropic(prompt);
      break;
    case 'openai':
      response = await callOpenAI(prompt);
      break;
    case 'gemini':
      response = await callGemini(prompt);
      break;
    case 'deepseek':
      response = await callDeepSeek(prompt);
      break;
    case 'ollama':
      response = await callOllama(prompt, model);
      break;
    default:
      throw new Error(`Unsupported AI provider: ${selectedProvider}`);
  }

  if (organizationId) {
    try {
      const supabase = getSupabase();
      await supabase.from('analytics').insert({
        organization_id: organizationId,
        event_type: 'ai_model_usage',
        metadata: {
          model: response.model,
          provider: response.provider,
          prompt: prompt.slice(0, 500),
          response_length: response.text.length,
          user_id: userId || null,
          timestamp: new Date().toISOString(),
          usage: response.usage,
        },
      });
    } catch (e: any) {
      console.error('Failed to log AI usage:', e.message);
    }
  }

  return response;
}
