import { getConfig } from './config.js';
export class LLMGateway {
    config;
    totalCost = 0;
    totalTokens = 0;
    constructor() {
        this.config = getConfig();
    }
    async execute(request, options) {
        const promptText = typeof request === 'string' ? request : request.prompt || '';
        const provider = typeof request === 'object' ? request.provider : options?.provider || 'mock';
        const model = typeof request === 'object' ? request.model : options?.model || 'mock-model';
        this.totalTokens += 370;
        this.totalCost += 0.001;
        return {
            text: `[KLYN AI Mock Output for: "${promptText.slice(0, 50)}..."] Technical architecture & specification processed successfully.`,
            usage: {
                promptTokens: 120,
                completionTokens: 250,
                totalTokens: 370
            },
            model,
            provider
        };
    }
    async complete(prompt, options) {
        return this.execute(prompt, options);
    }
    async chat(messages, options) {
        const lastMsg = messages[messages.length - 1]?.content || '';
        return this.execute(lastMsg, options);
    }
    getCostMetrics() {
        return {
            totalCost: this.totalCost,
            totalTokens: this.totalTokens,
            currency: 'USD',
            breakdown: {
                mock: { cost: this.totalCost, tokens: this.totalTokens }
            }
        };
    }
    getMetrics() {
        return this.getCostMetrics();
    }
}
export default LLMGateway;
