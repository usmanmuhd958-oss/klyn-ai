export type SandboxStatus = "created" | "running" | "stopped" | "failed";

export interface Sandbox {
  id: string;
  workspaceId: string;
  projectId: string;
  status: SandboxStatus;
  createdAt: number;
}

export interface SandboxCommand {
  sandboxId: string;
  command: string;
}

class SandboxManager {
  private sandboxes: Map<string, Sandbox> = new Map();

  create(params: { workspaceId: string; projectId: string }) {
    const sandbox: Sandbox = {
      id: crypto.randomUUID(),
      workspaceId: params.workspaceId,
      projectId: params.projectId,
      status: "created",
      createdAt: Date.now(),
    };

    this.sandboxes.set(sandbox.id, sandbox);
    return sandbox;
  }

  async start(sandboxId: string) {
    const sandbox = this.requireSandbox(sandboxId);
    sandbox.status = "running";
    return sandbox;
  }

  async execute(command: SandboxCommand) {
    const sandbox = this.requireSandbox(command.sandboxId);

    if (sandbox.status !== "running") {
      throw new Error("Sandbox is not running");
    }

    return {
      sandboxId: sandbox.id,
      command: command.command,
      output: "Command executed in isolated runtime",
    };
  }

  stop(sandboxId: string) {
    const sandbox = this.requireSandbox(sandboxId);
    sandbox.status = "stopped";
  }

  private requireSandbox(id: string) {
    const sandbox = this.sandboxes.get(id);

    if (!sandbox) {
      throw new Error("Sandbox not found");
    }

    return sandbox;
  }
}

export const sandboxManager = new SandboxManager();
