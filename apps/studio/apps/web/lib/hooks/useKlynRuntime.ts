"use client";

import { useEffect } from "react";
import { klynEventBus } from "../runtime/eventBus";
import { useKlynStore } from "../store/useKlynStore";
import type { Node, Edge } from "@xyflow/react";

export function useKlynRuntime() {
  const addNode = useKlynStore((state) => state.addNode);
  const addEdge = useKlynStore((state) => state.addEdge);
  const updateNode = useKlynStore((state) => state.updateNode);
  const updateAgent = useKlynStore((state) => state.updateAgent);
  const addAgentLog = useKlynStore((state) => state.addAgentLog);

  useEffect(() => {
    const onNodeCreated = (event: any) => {
      addNode(event.payload as Node);
    };

    const onNodeUpdated = (event: any) => {
      const { id, data } = event.payload;
      updateNode(id, data);
    };

    const onEdgeCreated = (event: any) => {
      addEdge(event.payload as Edge);
    };

    const onAgentStarted = (event: any) => {
      const { agent, task } = event.payload;
      updateAgent(agent, {
        status: "executing",
        currentTask: task,
      });
      addAgentLog(agent, `Started: ${task}`);
    };

    const onAgentThinking = (event: any) => {
      const { agent, message } = event.payload;
      updateAgent(agent, {
        status: "thinking",
      });
      addAgentLog(agent, message);
    };

    const onAgentExecuting = (event: any) => {
      const { agent, message } = event.payload;
      updateAgent(agent, {
        status: "executing",
      });
      addAgentLog(agent, message);
    };

    const onAgentCompleted = (event: any) => {
      const { agent, message } = event.payload;
      updateAgent(agent, {
        status: "done",
        currentTask: "Completed",
      });
      addAgentLog(agent, message);
    };

    klynEventBus.on("node.created", onNodeCreated);
    klynEventBus.on("node.updated", onNodeUpdated);
    klynEventBus.on("edge.created", onEdgeCreated);

    klynEventBus.on("agent.started", onAgentStarted);
    klynEventBus.on("agent.thinking", onAgentThinking);
    klynEventBus.on("agent.executing", onAgentExecuting);
    klynEventBus.on("agent.completed", onAgentCompleted);

    return () => {
      klynEventBus.off("node.created", onNodeCreated);
      klynEventBus.off("node.updated", onNodeUpdated);
      klynEventBus.off("edge.created", onEdgeCreated);

      klynEventBus.off("agent.started", onAgentStarted);
      klynEventBus.off("agent.thinking", onAgentThinking);
      klynEventBus.off("agent.executing", onAgentExecuting);
      klynEventBus.off("agent.completed", onAgentCompleted);
    };
  }, [addNode, addEdge, updateNode, updateAgent, addAgentLog]);
}
