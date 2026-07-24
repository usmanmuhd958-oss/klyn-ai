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
export declare function callAI(request: AIRequest): Promise<AIResponse>;
export {};
//# sourceMappingURL=ai.service.d.ts.map