import { getSupabase } from '../lib/supabase.js';

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

async function callAnthropic(prompt: string): Promise<AIResponse> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set');
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-fable-5',
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!(res as any).ok) throw new Error(`Anthropic API error: ${(res as any).status} ${(res as any).statusText}`);
  const data: any = await (res as any).json();
  const text = data?.content?.[0]?.text || '';
  return {
    text,
    model: 'claude-fable-5',
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
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-5.6-sol',
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!(res as any).ok) throw new Error(`OpenAI API error: ${(res as any).status} ${(res as any).statusText}`);
  const data: any = await (res as any).json();
  const text = data?.choices?.[0]?.message?.content || '';
  return {
    text,
    model: 'gpt-5.6-sol',
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
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-pro:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
    }),
  });
  if (!(res as any).ok) throw new Error(`Gemini API error: ${(res as any).status} ${(res as any).statusText}`);
  const data: any = await (res as any).json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  return {
    text,
    model: 'gemini-3.5-pro',
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
  const res = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'deepseek-v4-pro',
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!(res as any).ok) throw new Error(`DeepSeek API error: ${(res as any).status} ${(res as any).statusText}`);
  const data: any = await (res as any).json();
  const text = data?.choices?.[0]?.message?.content || '';
  return {
    text,
    model: 'deepseek-v4-pro',
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
  const res = await fetch(`${host}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: usedModel,
      prompt,
      stream: false,
    }),
  });
  if (!(res as any).ok) throw new Error(`Ollama API error: ${(res as any).status} ${(res as any).statusText}`);
  const data: any = await (res as any).json();
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
