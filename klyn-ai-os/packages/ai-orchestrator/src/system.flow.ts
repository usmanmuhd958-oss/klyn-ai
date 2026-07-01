/**
 * KLYN AI OS - SYSTEM FLOW SPECIFICATION
 */

export const SYSTEM_FLOW = {
  entry: "KlynOS",

  pipeline: [
    "AIModelRouter",
    "KlynAIKernel",
    "AgentRuntime",
    "WorkflowEngine",
    "MemoryLayer"
  ],

  rules: {
    alwaysUseRouter: true,
    enforceAgentRuntime: true,
    persistMemory: true,
    allowSelfRewrite: true
  }
};
