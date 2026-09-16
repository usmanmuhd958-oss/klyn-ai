export interface Capability {
  name: string;
  description: string;
  status: "available" | "missing" | "experimental";
}

export interface SystemModel {
  name: string;
  version: string;
  capabilities: Capability[];
  weaknesses: string[];
  updatedAt: Date;
}

export class SelfModelEngine {

  private model: SystemModel;

  constructor() {
    this.model = {
      name: "KLYN AI OS",
      version: "1.0",
      capabilities: [],
      weaknesses: [],
      updatedAt: new Date(),
    };
  }

  registerCapability(capability: Capability): void {
    this.model.capabilities.push(capability);
    this.model.updatedAt = new Date();
  }

  addWeakness(weakness: string): void {
    this.model.weaknesses.push(weakness);
    this.model.updatedAt = new Date();
  }

  getModel(): SystemModel {
    return this.model;
  }
}
