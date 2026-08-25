"use client";

import { klynEventBus } from "./eventBus";
import { generateWithAI } from "./aiGateway";

export type MissionAgent = "architect" | "coder" | "reviewer" | "guard";

interface MissionTask {
  id: string;
  agent: MissionAgent;
  title: string;
  prompt: string;
}

interface Mission {
  id: string;
  objective: string;
  tasks: MissionTask[];
}

function id(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

export function createMission(objective: string): Mission {
  return {
    id: id("mission"),
    objective,
    tasks: [
      {
        id: id("task"),
        agent: "architect",
        title: "Architecture Design",
        prompt: `Analyze this software request and create a technical architecture:\n\n${objective}`,
      },
      {
        id: id("task"),
        agent: "coder",
        title: "Code Generation",
        prompt: `Generate production ready implementation:\n\n${objective}`,
      },
      {
        id: id("task"),
        agent: "reviewer",
        title: "Code Review",
        prompt: `Review this generated solution for bugs and improvements:\n\n${objective}`,
      },
      {
        id: id("task"),
        agent: "guard",
        title: "Security Verification",
        prompt: `Analyze security risks:\n\n${objective}`,
      },
    ],
  };
}

export async function executeMission(mission: Mission) {
  klynEventBus.emit("mission.started", mission);

  for (const task of mission.tasks) {
    klynEventBus.emit("agent.started", {
      agent: task.agent,
      task: task.title,
    });

    try {
      klynEventBus.emit("agent.thinking", {
        agent: task.agent,
        message: "Calling AI Gateway...",
      });

      const result = await generateWithAI({
        provider: "openrouter",
        role: task.agent,
        prompt: task.prompt,
      });

      klynEventBus.emit("agent.executing", {
        agent: task.agent,
        message: "Processing generated artifact...",
      });

      klynEventBus.emit("artifact.generated", {
        agent: task.agent,
        content: result.content,
      });

      klynEventBus.emit("agent.completed", {
        agent: task.agent,
        message: `${task.title} completed`,
      });
    } catch (error) {
      klynEventBus.emit("agent.error", {
        agent: task.agent,
        message:
          error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  klynEventBus.emit("mission.completed", mission);
}
