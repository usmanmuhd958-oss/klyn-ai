/**
 * Google Gemini Provider
 */
import { GoogleGenerativeAI } from '@google/generative-ai';
// @ts-ignore
import { MODEL_REGISTRY } from '../config.ts';
export class GoogleProvider {
    client;
    config;
    constructor(config) {
        this.config = config;
        this.client = new GoogleGenerativeAI(config.apiKey);
    }
    async generate(request, modelName) {
        const startTime = Date.now();
        const modelConfig = MODEL_REGISTRY[modelName];
        try {
            const model = this.client.getGenerativeModel({
                model: modelConfig.apiModelId,
                // @ts-ignore
                systemInstruction: request.systemPrompt,
            });
            const result = await model.generateContent({
                contents: [{ role: 'user', parts: [{ text: request.prompt }] }],
                generationConfig: {
                    maxOutputTokens: request.maxTokens || 4096,
                    temperature: request.temperature ?? 0.7,
                    topP: request.topP,
                    stopSequences: request.stopSequences,
                },
            });
            const response = result.response;
            const text = response.text();
            // Gemini doesn't always provide token counts
            const usage = {
                // @ts-ignore
                inputTokens: response.usageMetadata?.promptTokenCount || 0,
                // @ts-ignore
                outputTokens: response.usageMetadata?.candidatesTokenCount || 0,
                // @ts-ignore
                totalTokens: response.usageMetadata?.totalTokenCount || 0,
            };
            const cost = {
                inputCost: (usage.inputTokens / 1_000_000) * modelConfig.costPerMToken,
                outputCost: (usage.outputTokens / 1_000_000) * modelConfig.costPerMTokenOutput,
                totalCost: 0,
            };
            cost.totalCost = cost.inputCost + cost.outputCost;
            return {
                content: text,
                model: modelConfig.modelName,
                provider: 'google',
                usage,
                cost,
                finishReason: 'stop',
                latencyMs: Date.now() - startTime,
            };
        }
        catch (error) {
            throw this.handleError(error, modelName);
        }
    }
    async *stream(request, modelName) {
        const modelConfig = MODEL_REGISTRY[modelName];
        try {
            const model = this.client.getGenerativeModel({
                model: modelConfig.apiModelId,
                // @ts-ignore
                systemInstruction: request.systemPrompt,
            });
            const result = await model.generateContentStream({
                contents: [{ role: 'user', parts: [{ text: request.prompt }] }],
                generationConfig: {
                    maxOutputTokens: request.maxTokens || 4096,
                    temperature: request.temperature ?? 0.7,
                },
            });
            for await (const chunk of result.stream) {
                const text = chunk.text();
                yield {
                    delta: text,
                    model: modelConfig.modelName,
                    isComplete: false,
                };
            }
            yield {
                delta: '',
                model: modelConfig.modelName,
                isComplete: true,
            };
        }
        catch (error) {
            throw this.handleError(error, modelName);
        }
    }
    handleError(error, modelName) {
        const isRetryable = error.status === 429 || error.status >= 500;
        return {
            name: 'ProviderError',
            message: error.message || 'Google API error',
            provider: 'google',
            model: modelName,
            statusCode: error.status,
            retryable: isRetryable,
        };
    }
}
