// packages/intent-engine/src/parser/IntentParser.ts

import { z } from 'zod'

export const IntentSchema = z.object({
  id: z.string().uuid(),
  raw: z.string(),
  timestamp: z.number(),
  domain: z.enum([
    'fintech', 'ecommerce', 'saas', 'ml', 'mobile', 
    'enterprise', 'consumer', 'infrastructure', 'unknown'
  ]),
  scale: z.enum(['prototype', 'startup', 'growth', 'enterprise', 'global']),
  goals: z.array(z.object({
    id: z.string(),
    label: z.string(),
    type: z.enum(['feature', 'quality', 'constraint', 'integration']),
    priority: z.number().min(1).max(10),
    ambiguityScore: z.number().min(0).max(1), // 0 = clear, 1 = unclear
    technicalSignals: z.array(z.string()),
  })),
  entities: z.array(z.object({
    name: z.string(),
    type: z.enum(['service', 'data', 'user', 'external', 'infrastructure']),
    attributes: z.record(z.unknown()),
  })),
  constraints: z.array(z.object({
    type: z.enum(['compliance', 'performance', 'budget', 'timeline', 'technology']),
    value: z.string(),
  })),
  confidence: z.number().min(0).max(1),
})

export type Intent = z.infer<typeof IntentSchema>

export class IntentParser {
  async parse(input: string, context?: IntentMemoryContext): Promise<Intent> {
    // 1. Send to LLM with structured extraction prompt
    const extracted = await this.extractWithLLM(input, context)
    
    // 2. Validate against schema
    const parsed = IntentSchema.parse(extracted)
    
    // 3. Detect ambiguities that need clarification
    const ambiguities = parsed.goals.filter(g => g.ambiguityScore > 0.6)
    
    // 4. Augment with domain knowledge
    return this.augmentWithDomainKnowledge(parsed)
  }

  private async extractWithLLM(input: string, context?: IntentMemoryContext) {
    // Uses structured output / function calling
    // Returns JSON matching IntentSchema
  }

  private augmentWithDomainKnowledge(intent: Intent): Intent {
    // Add implied requirements based on domain
    // e.g., fintech → PCI DSS, GDPR, audit logs implied
    return intent
  }
}