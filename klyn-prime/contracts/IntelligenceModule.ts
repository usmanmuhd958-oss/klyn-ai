export interface IntelligenceModule {

  name: string;

  initialize(): Promise<void>;

  analyze(input: unknown): Promise<unknown>;

  execute(task: unknown): Promise<unknown>;

  learn(result: unknown): Promise<void>;

}
