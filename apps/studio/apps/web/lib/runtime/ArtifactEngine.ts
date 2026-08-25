"use client";

import type { Node } from "@xyflow/react";
import { klynEventBus } from "./eventBus";

interface ArtifactPayload {
  agent: string;
  content: string;
}

function createId(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

export function createArtifactNode(artifact: ArtifactPayload): Node {
  return {
    id: createId("code"),
    type: "code",
    position: {
      x: Math.floor(Math.random() * 600),
      y: Math.floor(Math.random() * 400),
    },
    data: {
      file: `${artifact.agent}-generated.ts`,
      language: "typescript",
      content: artifact.content,
      generatedBy: artifact.agent,
    },
  };
}

export function initializeArtifactEngine() {
  klynEventBus.on("artifact.generated", (event) => {
    const artifact = event.payload as ArtifactPayload;
    const node = createArtifactNode(artifact);
    klynEventBus.emit("node.created", node);
  });
}
