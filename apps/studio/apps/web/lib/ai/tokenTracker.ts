interface TokenUsage {
  workspaceId: string;
  userId: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

interface UsageRecord extends TokenUsage {
  createdAt: number;
}

class TokenTracker {
  private records: UsageRecord[] = [];

  async record(usage: TokenUsage) {
    this.records.push({
      ...usage,
      createdAt: Date.now(),
    });
  }

  getWorkspaceUsage(workspaceId: string) {
    return this.records
      .filter((record) => record.workspaceId === workspaceId)
      .reduce((total, current) => {
        return total + current.inputTokens + current.outputTokens;
      }, 0);
  }

  async checkQuota(workspaceId: string, limit: number): Promise<boolean> {
    const usage = this.getWorkspaceUsage(workspaceId);
    return usage < limit;
  }

  clearWorkspace(workspaceId: string) {
    this.records = this.records.filter(
      (record) => record.workspaceId !== workspaceId
    );
  }
}

export const tokenTracker = new TokenTracker();
