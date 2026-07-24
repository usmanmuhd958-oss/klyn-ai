export class CostOptimizer {
    constructor() { }
    optimize(prompt) {
        return {
            provider: 'mock',
            model: 'mock-model'
        };
    }
    optimizeRoute(prompt) {
        return this.optimize(prompt);
    }
}
export default CostOptimizer;
