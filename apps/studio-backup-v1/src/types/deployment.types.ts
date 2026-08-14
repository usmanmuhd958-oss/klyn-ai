export type DeploymentStatus =
  | "queued"
  | "building"
  | "testing"
  | "deploying"
  | "healthy"
  | "failed"
  | "rollback";

export interface DeploymentEnvironment {
  id:string;
  name:string;
  provider:string;
  region:string;
  status:DeploymentStatus;
}

export interface DeploymentEvent {
  id:string;
  service:string;
  action:string;
  status:DeploymentStatus;
  timestamp:number;
}

export interface DeploymentHealth {
  score:number;
  uptime:number;
  errors:number;
  latency:number;
}
