export class EnterpriseReliability {

  async executeWithRetry(fn: () => Promise<any>, retries = 3) {
    let lastError: any;

    for (let i = 0; i < retries; i++) {
      try {
        return await fn();
      } catch (err) {
        lastError = err;
      }
    }

    throw new Error("Failed after retries: " + lastError);
  }
}
