export type ModelCapability =
  | "coding"
  | "reasoning"
  | "planning"
  | "analysis"
  | "security"
  | "creative";


export interface AIModel {
  name: string;
  provider: string;
  capabilities: ModelCapability[];
  score: number;
}


export interface TaskRequest {
  task: string;
  requiredCapability: ModelCapability;
}


export class ModelRouter {

  private models: AIModel[] = [];


  registerModel(model: AIModel) {
    this.models.push(model);
  }


  selectModel(request: TaskRequest): AIModel | undefined {

    const candidates = this.models.filter(model =>
      model.capabilities.includes(
        request.requiredCapability
      )
    );


    return candidates.sort(
      (a,b) => b.score - a.score
    )[0];

  }


  listModels() {
    return this.models;
  }

}
