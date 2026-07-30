import { Agent } from "./Agent";


export class AgentFactory {


  create(
    name:string,
    role:string
  ){

    return new Agent(
      {
        id: crypto.randomUUID(),
        name,
        role
      },
      []
    );

  }


}
