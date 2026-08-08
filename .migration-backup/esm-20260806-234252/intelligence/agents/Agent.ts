export interface Agent {

  id: string;

  name: string;

  capability: string[];

  execute(
    task: unknown
  ): Promise<unknown>;

}
