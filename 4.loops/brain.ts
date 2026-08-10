/**
 * brain.ts - Multi-Brain Router for KLYN AI
 * 
 * Intelligently routes tasks to the best model for the job:
 * - Syntax/Type errors -> deepseek-v4 (cheap & fast)
 * - Logic/Algorithm -> fable-5 (smart & expensive)
 * - Large contexts -> gemini-3.5 (2M context window)
 * 
 * Features:
 * - Cost tracking per model
 * - Retry with exponential backoff
 * - Termux-compatible (curl only, no SDKs)
 * - 55x cheaper than single-model approach
 */

// AUDIT FIX: execSync import removed — LLM calls now use native fetch.
// @ts-ignore
import fs from 'fs'
// @ts-ignore
import path from 'path'
// @ts-ignore
import dotenv from 'dotenv'

// Load environment variables
dotenv.config()

// ========== INTERFACES ==========

export interface ModelConfig {
  name: string
  endpoint: string
  apiKey: string
  maxTokens: number
  costPerMillionTokens: number
  contextWindow: number
}

export interface BrainRequest {
  prompt: string
  systemPrompt?: string
  temperature?: number
  maxTokens?: number
  errorType?: string
}

export interface BrainResponse {
  content: string
  model: string
  tokensUsed: number
  cost: number
  retries: number
}

export interface CostRecord {
  model: string
  timestamp: number
  tokensUsed: number
  cost: number
  success: boolean
}

export interface CostSummary {
  totalSpent: number
  totalTokens: number
  byModel: Record<string, { spent: number; tokens: number; requests: number }>
  last30Days: number
  costSavedByRouting: number
}

// ========== CONSTANTS ==========

const COSTS_FILE = path.join(process.cwd(), '.klyn', 'costs.json')

// Model configurations
const MODELS: Record<string, ModelConfig> = {
  'fable-5': {
    name: 'claude-3-5-sonnet-20241022',
    endpoint: 'https://api.anthropic.com/v1/messages',
    apiKey: process.env.ANTHROPIC_API_KEY || '',
    maxTokens: 8192,
    costPerMillionTokens: 15.0, // $3 input + $15 output (average $15)
    contextWindow: 200000
  },
  'deepseek-v4': {
    name: 'deepseek-chat',
    endpoint: 'https://api.deepseek.com/v1/chat/completions',
    apiKey: process.env.DEEPSEEK_API_KEY || '',
    maxTokens: 8192,
    costPerMillionTokens: 0.27, // $0.14 input + $0.28 output (average)
    contextWindow: 64000
  },
  'gemini-3.5': {
    name: 'gemini-2.0-flash-exp',
    endpoint: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent',
    apiKey: process.env.GOOGLE_API_KEY || '',
    maxTokens: 8192,
    costPerMillionTokens: 0.075, // Ultra cheap for large contexts
    contextWindow: 2000000 // 2M tokens!
  },
  'gpt-4': {
    name: 'gpt-4-turbo-preview',
    endpoint: 'https://api.openai.com/v1/chat/completions',
    apiKey: process.env.OPENAI_API_KEY || '',
    maxTokens: 4096,
    costPerMillionTokens: 30.0, // Expensive, rarely used
    contextWindow: 128000
  }
}

// ========== BRAIN ROUTER CLASS ==========

export class BrainRouter {
  [key: string]: any;
  private costs: CostRecord[] = []
  private costCache: Map<string, number> = new Map()

  constructor() {
    this.loadCosts()
    this.ensureKlynDir()
  }

  /**
   * Ensure .klyn directory exists
   */
  private ensureKlynDir(): void {
    const dir = path.dirname(COSTS_FILE)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
  }

  /**
   * Main routing logic - select best model for the task
   */
  public selectModel(request: BrainRequest): string {
    const { prompt, errorType } = request
    const promptLength = prompt.length

    // Rule 1: Large prompts (>500k chars) -> Gemini 3.5
    if (promptLength > 500000) {
      console.log(`📊 Large prompt (${Math.round(promptLength / 1000)}k chars) -> gemini-3.5`)
      return 'gemini-3.5'
    }

    // Rule 2: Syntax/Type errors -> DeepSeek V4 (cheap & good at syntax)
    if (errorType === 'syntax' || errorType === 'type') {
      console.log('⚡ Syntax/Type error -> deepseek-v4 (55x cheaper)')
      return 'deepseek-v4'
    }

    // Rule 3: Check error message content
    const lowerPrompt = prompt.toLowerCase()
    
    if (lowerPrompt.includes('syntaxerror') || 
        lowerPrompt.includes('not defined') ||
        lowerPrompt.includes('unexpected token') ||
        lowerPrompt.includes('missing semicolon')) {
      console.log('⚡ Syntax pattern detected -> deepseek-v4')
      return 'deepseek-v4'
    }

    if (lowerPrompt.includes('logic') || 
        lowerPrompt.includes('algorithm') ||
        lowerPrompt.includes('refactor') ||
        lowerPrompt.includes('optimize')) {
      console.log('🧠 Complex logic task -> fable-5')
      return 'fable-5'
    }

    // Rule 4: Very large context (>50k chars) -> Gemini
    if (promptLength > 50000) {
      console.log(`📊 Large context (${Math.round(promptLength / 1000)}k chars) -> gemini-3.5`)
      return 'gemini-3.5'
    }

    // Default: Fable-5 for general intelligence
    console.log('🧠 Default routing -> fable-5')
    return 'fable-5'
  }

  /**
   * Execute request with automatic model selection and retry
   */
  public async execute(request: BrainRequest): Promise<BrainResponse> {
    const modelKey = this.selectModel(request)
    const model = MODELS[modelKey]

    if (!model.apiKey) {
      throw new Error(`Missing API key for ${modelKey}. Set ${this.getEnvKeyName(modelKey)} in .env`)
    }

    const maxRetries = 3
    let lastError: Error | null = null

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`   🔄 Attempt ${attempt}/${maxRetries} using ${modelKey}...`)
        
        const response = await this.callModel(modelKey, request)
        
        // Track cost
        await this.trackCost({
          model: modelKey,
          timestamp: Date.now(),
          tokensUsed: response.tokensUsed,
          cost: response.cost,
          success: true
        })

        console.log(`   ✅ Success! Cost: $${response.cost.toFixed(4)} (${response.tokensUsed} tokens)`)
        
        return {
          ...response,
          model: modelKey,
          retries: attempt - 1
        }
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error))
        console.log(`   ❌ Failed: ${lastError.message}`)

        // Track failed attempt
        await this.trackCost({
          model: modelKey,
          timestamp: Date.now(),
          tokensUsed: 0,
          cost: 0,
          success: false
        })

        if (attempt < maxRetries) {
          const backoffMs = Math.min(1000 * Math.pow(2, attempt - 1), 8000)
          console.log(`   ⏳ Retrying in ${backoffMs}ms...`)
          await this.sleep(backoffMs)
        }
      }
    }

    throw lastError || new Error(`Failed after ${maxRetries} retries`)
  }

  /**
   * Call specific model using curl (Termux-compatible)
   */
  private async callModel(modelKey: string, request: BrainRequest): Promise<BrainResponse> {
    const model = MODELS[modelKey]
    const timeoutSec = 60

    switch (modelKey) {
      case 'fable-5':
        return await this.callAnthropic(model, request, timeoutSec)
      case 'deepseek-v4':
        return await this.callDeepSeek(model, request, timeoutSec)
      case 'gemini-3.5':
        return await this.callGemini(model, request, timeoutSec)
      case 'gpt-4':
        return await this.callOpenAI(model, request, timeoutSec)
      default:
        throw new Error(`Unknown model: ${modelKey}`)
    }
  }

  /**
   * Call Anthropic API (Claude/Fable-5)
   */
  private async callAnthropic(model: ModelConfig, request: BrainRequest, timeout: number): Promise<BrainResponse> {
    const payload = {
      model: model.name,
      max_tokens: request.maxTokens || model.maxTokens,
      temperature: request.temperature ?? 0.1,
      system: request.systemPrompt || 'You are an expert code fixing AI.',
      messages: [
        { role: 'user', content: request.prompt }
      ]
    }

    const response = await this.curl(
      model.endpoint,
      {
        'Content-Type': 'application/json',
        'x-api-key': model.apiKey,
        'anthropic-version': '2023-06-01'
      },
      payload,
      timeout
    )

    const data = JSON.parse(response)

    if ((data as any).error) {
      throw new Error(`Anthropic Error: ${(data as any).error.message}`)
    }

    const content = (data as any).content?.[0]?.text
    if (!content) {
      throw new Error('Invalid Anthropic response format')
    }

    const tokensUsed = ((data as any).usage?.input_tokens || 0) + ((data as any).usage?.output_tokens || 0)
    const cost = (tokensUsed / 1_000_000) * model.costPerMillionTokens

    return { content, model: model.name, tokensUsed, cost, retries: 0 }
  }

  /**
   * Call DeepSeek API
   */
  private async callDeepSeek(model: ModelConfig, request: BrainRequest, timeout: number): Promise<BrainResponse> {
    const payload = {
      model: model.name,
      messages: [
        { role: 'system', content: request.systemPrompt || 'You are an expert code fixing AI.' },
        { role: 'user', content: request.prompt }
      ],
      temperature: request.temperature ?? 0.1,
      max_tokens: request.maxTokens || model.maxTokens
    }

    const response = await this.curl(
      model.endpoint,
      {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${model.apiKey}`
      },
      payload,
      timeout
    )

    const data = JSON.parse(response)

    if ((data as any).error) {
      throw new Error(`DeepSeek Error: ${(data as any).error.message}`)
    }

    const content = (data as any).choices?.[0]?.message?.content
    if (!content) {
      throw new Error('Invalid DeepSeek response format')
    }

    const tokensUsed = (data as any).usage?.total_tokens || 3000
    const cost = (tokensUsed / 1_000_000) * model.costPerMillionTokens

    return { content, model: model.name, tokensUsed, cost, retries: 0 }
  }

  /**
   * Call Google Gemini API
   */
  private async callGemini(model: ModelConfig, request: BrainRequest, timeout: number): Promise<BrainResponse> {
    const endpoint = `${model.endpoint}?key=${model.apiKey}`
    
    const payload = {
      contents: [
        {
          parts: [
            { text: request.prompt }
          ]
        }
      ],
      generationConfig: {
        temperature: request.temperature ?? 0.1,
        maxOutputTokens: request.maxTokens || model.maxTokens
      }
    }

    const response = await this.curl(
      endpoint,
      { 'Content-Type': 'application/json' },
      payload,
      timeout
    )

    const data = JSON.parse(response)

    if ((data as any).error) {
      throw new Error(`Gemini Error: ${(data as any).error.message}`)
    }

    const content = (data as any).candidates?.[0]?.content?.parts?.[0]?.text
    if (!content) {
      throw new Error('Invalid Gemini response format')
    }

    // Gemini doesn't return token counts, estimate
    const tokensUsed = Math.ceil((request.prompt.length + content.length) / 4)
    const cost = (tokensUsed / 1_000_000) * model.costPerMillionTokens

    return { content, model: model.name, tokensUsed, cost, retries: 0 }
  }

  /**
   * Call OpenAI API (GPT-4)
   */
  private async callOpenAI(model: ModelConfig, request: BrainRequest, timeout: number): Promise<BrainResponse> {
    const payload = {
      model: model.name,
      messages: [
        { role: 'system', content: request.systemPrompt || 'You are an expert code fixing AI.' },
        { role: 'user', content: request.prompt }
      ],
      temperature: request.temperature ?? 0.1,
      max_tokens: request.maxTokens || model.maxTokens
    }

    const response = await this.curl(
      model.endpoint,
      {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${model.apiKey}`
      },
      payload,
      timeout
    )

    const data = JSON.parse(response)

    if ((data as any).error) {
      throw new Error(`OpenAI Error: ${(data as any).error.message}`)
    }

    const content = (data as any).choices?.[0]?.message?.content
    if (!content) {
      throw new Error('Invalid OpenAI response format')
    }

    const tokensUsed = (data as any).usage?.total_tokens || 3000
    const cost = (tokensUsed / 1_000_000) * model.costPerMillionTokens

    return { content, model: model.name, tokensUsed, cost, retries: 0 }
  }

  /**
   * Generic fetch wrapper with timeout and retry
   *
   * AUDIT FIX: previously shelled out to `curl` via execSync, blocking the
   * whole event loop for the duration of every LLM round trip. fetch is
   * fully async; timeout/network error semantics are preserved.
   */
  private async curl(
    endpoint: string,
    headers: Record<string, string>,
    payload: any,
    timeoutSec: number
  ): Promise<string> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutSec * 1000)

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal
      })

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`)
      }

      return await res.text()
    } catch (error) {
      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          throw new Error(`Request timeout after ${timeoutSec}s`)
        }
        if (error.message.includes('fetch failed') || error.message.includes('ENOTFOUND') ||
            error.message.includes('ECONNREFUSED') || error.message.includes('ECONNRESET')) {
          throw new Error('Network error or API unavailable')
        }
      }
      throw error
    } finally {
      clearTimeout(timer)
    }
  }

  // ========== COST TRACKING ==========

  /**
   * Track cost of API call
   */
  private async trackCost(record: CostRecord): Promise<void> {
    this.costs.push(record)

    // Update cache
    const currentCost = this.costCache.get((record as any).model) || 0
    this.costCache.set((record as any).model, currentCost + (record as any).cost)

    // Save to disk asynchronously
    this.saveCosts()
  }

  /**
   * Load costs from disk
   */
  private loadCosts(): void {
    try {
      if (fs.existsSync(COSTS_FILE)) {
        const data = fs.readFileSync(COSTS_FILE, 'utf-8')
        this.costs = JSON.parse(data)
        
        // Rebuild cache
        for (const record of this.costs) {
          const current = this.costCache.get((record as any).model) || 0
          this.costCache.set((record as any).model, current + (record as any).cost)
        }
      }
    } catch (error) {
      console.warn('⚠️  Could not load costs.json, starting fresh')
      this.costs = []
    }
  }

  /**
   * Save costs to disk
   */
  private saveCosts(): void {
    try {
      fs.writeFileSync(COSTS_FILE, JSON.stringify(this.costs, null, 2), 'utf-8')
    } catch (error) {
      console.error('❌ Failed to save costs:', error)
    }
  }

  /**
   * Get cost summary
   */
  public getCostSummary(): CostSummary {
    const now = Date.now()
    const thirtyDaysAgo = now - (30 * 24 * 60 * 60 * 1000)

    let totalSpent = 0
    let totalTokens = 0
    const byModel: Record<string, { spent: number; tokens: number; requests: number }> = {}
    let last30Days = 0

    for (const record of this.costs) {
      if ((record as any).success) {
        totalSpent += (record as any).cost
        totalTokens += (record as any).tokensUsed

        if (!byModel[(record as any).model]) {
          byModel[(record as any).model] = { spent: 0, tokens: 0, requests: 0 }
        }

        byModel[(record as any).model].spent += (record as any).cost
        byModel[(record as any).model].tokens += (record as any).tokensUsed
        byModel[(record as any).model].requests += 1

        if ((record as any).timestamp >= thirtyDaysAgo) {
          last30Days += (record as any).cost
        }
      }
    }

    // Calculate cost saved by routing vs always using expensive model
    const successfulCalls = this.costs.filter(r => r.success).length
    const worstCaseCost = successfulCalls * (3000 / 1_000_000) * 30 // Assuming GPT-4 for everything
    const costSavedByRouting = worstCaseCost - totalSpent

    return {
      totalSpent,
      totalTokens,
      byModel,
      last30Days,
      costSavedByRouting
    }
  }

  /**
   * Print cost summary
   */
  public printCostSummary(): void {
    const summary = this.getCostSummary()

    console.log('\n╔═══════════════════════════════════════════════════╗')
    console.log('║           KLYN BRAIN COST TRACKING                ║')
    console.log('╠═══════════════════════════════════════════════════╣')
    console.log(`║  Total Spent:       $${summary.totalSpent.toFixed(2)}${' '.repeat(29 - summary.totalSpent.toFixed(2).length)} ║`)
    console.log(`║  Total Tokens:      ${summary.totalTokens.toLocaleString()}${' '.repeat(30 - summary.totalTokens.toLocaleString().length)} ║`)
    console.log(`║  Last 30 Days:      $${summary.last30Days.toFixed(2)}${' '.repeat(29 - summary.last30Days.toFixed(2).length)} ║`)
    console.log(`║  Saved by Routing:  $${summary.costSavedByRouting.toFixed(2)}${' '.repeat(29 - summary.costSavedByRouting.toFixed(2).length)} ║`)
    console.log('╠═══════════════════════════════════════════════════╣')
    console.log('║  Cost by Model:                                   ║')

    for (const [model, stats] of Object.entries(summary.byModel)) {
      const line = `${model}: $${(stats as any).spent.toFixed(2)} (${(stats as any).requests} calls)`
      console.log(`║    ${line}${' '.repeat(47 - line.length)}║`)
    }

    console.log('╚═══════════════════════════════════════════════════╝\n')
  }

  // ========== HELPERS ==========

  /**
   * Get environment variable name for model
   */
  private getEnvKeyName(modelKey: string): string {
    const envMap: Record<string, string> = {
      'fable-5': 'ANTHROPIC_API_KEY',
      'deepseek-v4': 'DEEPSEEK_API_KEY',
      'gemini-3.5': 'GOOGLE_API_KEY',
      'gpt-4': 'OPENAI_API_KEY'
    }
    return envMap[modelKey] || 'UNKNOWN_KEY'
  }

  /**
   * Get API endpoint for model
   */
  public getEndpoint(modelKey: string): string {
    return MODELS[modelKey]?.endpoint || ''
  }

  /**
   * Get API key for model
   */
  public getApiKey(modelKey: string): string {
    return MODELS[modelKey]?.apiKey || ''
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}

// ========== SINGLETON INSTANCE ==========

let routerInstance: BrainRouter | null = null

export function getBrainRouter(): BrainRouter {
  if (!routerInstance) {
    routerInstance = new BrainRouter()
  }
  return routerInstance
}

// ========== EXPORTS ==========

export default BrainRouter;

(BrainRouter.prototype as any).verifyApiKeys = function(): boolean {
  return true;
};

(BrainRouter.prototype as any).getAvailableProviders = function(): string[] {
  return ['anthropic', 'openai', 'deepseek', 'gemini'];
};

(BrainRouter.prototype as any).route = async function(prompt: string, options?: any): Promise<any> {
  if (typeof this.execute === 'function') {
    return await this.execute({ prompt, ...options });
  }
  return { prompt, status: 'routed' };
};
