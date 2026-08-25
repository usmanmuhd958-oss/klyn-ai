import { klynEventBus } from "@/lib/runtime/eventBus";

export type DeploymentStatus =
  | "queued"
  | "building"
  | "deploying"
  | "success"
  | "failed";

export type DeploymentProvider = "vercel" | "docker" | "kubernetes";

export interface DeploymentRequest {
  workspaceId: string;
  projectId: string;
  provider: DeploymentProvider;
  artifactId: string;
}

export interface Deployment {
  id: string;
  workspaceId: string;
  projectId: string;
  provider: DeploymentProvider;
  artifactId: string;
  status: DeploymentStatus;
  url?: string;
  createdAt: number;
}

class DeploymentManager {
  private deployments: Map<string, Deployment> = new Map();

  async deploy(request: DeploymentRequest): Promise<Deployment> {
    const deployment: Deployment = {
      id: crypto.randomUUID(),
      workspaceId: request.workspaceId,
      projectId: request.projectId,
      provider: request.provider,
      artifactId: request.artifactId,
      status: "queued",
      createdAt: Date.now(),
    };

    this.deployments.set(deployment.id, deployment);

    klynEventBus.emit("deployment.started", deployment);

    try {
      await this.updateStatus(deployment.id, "building");
      await this.simulateBuild();
      await this.updateStatus(deployment.id, "deploying");

      const url = await this.deployProvider(request.provider);

      deployment.url = url;
      await this.updateStatus(deployment.id, "success");

      return deployment;
    } catch (error) {
      await this.updateStatus(deployment.id, "failed");
      throw error;
    }
  }

  private async updateStatus(id: string, status: DeploymentStatus) {
    const deployment = this.deployments.get(id);

    if (!deployment) {
      return;
    }

    deployment.status = status;
    klynEventBus.emit("deployment.updated", deployment);
  }

  private async simulateBuild() {
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  private async deployProvider(provider: DeploymentProvider) {
    switch (provider) {
      case "vercel":
        return "https://klyn-preview.vercel.app"\;
      case "docker":
        return "docker://klyn-container";
      case "kubernetes":
        return "k8s://klyn-service";
      default:
        throw new Error("Unsupported deployment provider");
    }
  }

  getDeployment(id: string) {
    return this.deployments.get(id);
  }
}

export const deploymentManager = new DeploymentManager();
