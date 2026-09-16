export interface RequestContext {
  requestId: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
}
