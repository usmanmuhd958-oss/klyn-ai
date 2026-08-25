export interface ModelConfig {
  provider: string;
  model: string;
  priority: number;
}

type TaskType = "code_generation" | "analysis" | "debug" | "architecture";

const models: Record<TaskType, ModelConfig> = {
  code_generation: {
    provider: "openai",
    model: "gpt-5",
    priority: 1,
  },
  analysis: {
    provider: "openai",
    model: "gpt-5",
    priority: 1,
  },
  debug: {
    provider: "openai",
    model: "gpt-5",
    priority: 1,
  },
  architecture: {
    provider: "openai",
    model: "gpt-5",
    priority: 1,
  },
};

export function selectModel(taskType:TaskType): ModelConfig {
  const config = models[taskType];

  if (!config) {
    throw new Error(`No model configured for ${taskType}`);
  }

  return config;
}
