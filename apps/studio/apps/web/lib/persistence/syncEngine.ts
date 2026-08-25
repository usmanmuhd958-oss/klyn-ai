"use client";

import type { Node, Edge } from "@xyflow/react";
import { artifactRepository } from "./artifactRepository";
import { graphRepository } from "./graphRepository";
import { klynEventBus } from "@/lib/runtime/eventBus";

type SyncOperationType = "node" | "edge" | "artifact";

interface SyncOperation {
  id: string;
  type: SyncOperationType;
  payload: unknown;
  retries: number;
  createdAt: number;
}

interface ArtifactPayload {
  projectId: string;
  filename: string;
  language: string;
  content: string;
  agentSource?: string;
}

const QUEUE_KEY = "klyn_offline_sync_queue";
const DEBOUNCE_TIME = 500;

class SyncEngine {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pending: SyncOperation[] = [];
  private maxRetries = 5;

  constructor() {
    this.registerEvents();
    this.restoreQueue();
  }

  /**
   * Listen to runtime events.
   */
  private registerEvents() {
    klynEventBus.on("node.created", (event) => {
      const node = event.payload as Node;
      this.queue({
        type: "node",
        payload: node,
      });
    });

    klynEventBus.on("node.updated", (event) => {
      const node = event.payload as Node;
      this.queue({
        type: "node",
        payload: node,
      });
    });

    klynEventBus.on("edge.created", (event) => {
      const edge = event.payload as Edge;
      this.queue({
        type: "edge",
        payload: edge,
      });
    });

    klynEventBus.on("artifact.generated", (event) => {
      this.queue({
        type: "artifact",
        payload: event.payload,
      });
    });
  }

  /**
   * Adds operation into debounce queue.
   */
  private queue(operation: Omit<SyncOperation, "id" | "retries" | "createdAt">) {
    this.pending.push({
      id: crypto.randomUUID(),
      retries: 0,
      createdAt: Date.now(),
      ...operation,
    });

    this.emitSyncState();
    this.startDebounce();
  }

  /**
   * Waits 500ms before writing.
   */
  private startDebounce() {
    if (this.timer) {
      clearTimeout(this.timer);
    }

    this.timer = setTimeout(() => {
      this.flush();
    }, DEBOUNCE_TIME);
  }

  /**
   * Sends pending changes.
   */
  private async flush() {
    const operations = [...this.pending];
    this.pending = [];

    for (const operation of operations) {
      try {
        await this.execute(operation);
        klynEventBus.emit("sync.success", operation);
      } catch (error) {
        console.error("Sync failed", error);
        this.handleFailure(operation);
      }
    }

    this.emitSyncState();
  }

  /**
   * Executes one persistence operation.
   */
  private async execute(operation: SyncOperation) {
    switch (operation.type) {
      case "node": {
        const node = operation.payload as Node;
        const projectId = node.data?.projectId as string;
        await graphRepository.saveNode(node, projectId);
        break;
      }

      case "edge": {
        const edge = operation.payload as Edge;
        const projectId = edge.data?.projectId as string;
        await graphRepository.saveEdge(edge, projectId);
        break;
      }

      case "artifact": {
        const artifact = operation.payload as ArtifactPayload;
        await artifactRepository.create({
          projectId: artifact.projectId,
          filename: artifact.filename,
          language: artifact.language,
          content: artifact.content,
          agentSource: artifact.agentSource,
        });
        break;
      }
    }
  }

  /**
   * Stores failed operations locally.
   */
  private handleFailure(operation: SyncOperation) {
    operation.retries++;

    if (operation.retries < this.maxRetries) {
      this.saveOffline(operation);
    } else {
      klynEventBus.emit("sync.failed", operation);
    }
  }

  /**
   * Save queue into browser storage.
   */
  private saveOffline(operation: SyncOperation) {
    const current = this.getOfflineQueue();
    localStorage.setItem(QUEUE_KEY, JSON.stringify([...current, operation]));
  }

  /**
   * Restore previous offline jobs.
   */
  private restoreQueue() {
    if (typeof window === "undefined") {
      return;
    }

    const saved = localStorage.getItem(QUEUE_KEY);
    if (!saved) {
      return;
    }

    try {
      const items: SyncOperation[] = JSON.parse(saved);
      this.pending.push(...items);
      localStorage.removeItem(QUEUE_KEY);
      this.startDebounce();
    } catch {
      console.warn("Unable to restore sync queue");
    }
  }

  private getOfflineQueue(): SyncOperation[] {
    if (typeof window === "undefined") {
      return [];
    }

    const data = localStorage.getItem(QUEUE_KEY);
    return data ? JSON.parse(data) : [];
  }

  private emitSyncState() {
    klynEventBus.emit("sync.status", {
      pending: this.pending.length,
      timestamp: Date.now(),
    });
  }
}

export const syncEngine = new SyncEngine();
