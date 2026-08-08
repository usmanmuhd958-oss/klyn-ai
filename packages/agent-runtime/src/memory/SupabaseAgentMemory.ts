import fs from "fs";
import path from "path";

export class SupabaseAgentMemory {

  [key: string]: any;

  private client: any;
  private memoryFile: string;

  constructor() {

    this.client = null;

    this.memoryFile = path.join(
      process.cwd(),
      "klyn-memory-store.json"
    );

    if (!fs.existsSync(this.memoryFile)) {
      fs.writeFileSync(
        this.memoryFile,
        JSON.stringify([], null, 2)
      );
    }
  }


  private readMemory() {

    return JSON.parse(
      fs.readFileSync(
        this.memoryFile,
        "utf8"
      )
    );

  }


  private writeMemory(data:any[]) {

    fs.writeFileSync(
      this.memoryFile,
      JSON.stringify(data,null,2)
    );

  }


  async storeMemory(agentId:string, memory:any) {

    const data = this.readMemory();

    data.push({
      type:"memory",
      agentId,
      memory,
      timestamp:Date.now()
    });

    this.writeMemory(data);

    return true;
  }


  async saveExecution(data:any) {

    const records = this.readMemory();

    records.push({
      type:"execution",
      ...data,
      timestamp:Date.now()
    });

    this.writeMemory(records);

    return true;
  }


  async recall(agentId?:string){

    const data = this.readMemory();

    if(!agentId){
      return data;
    }

    return data.filter(
      item=>item.agentId===agentId
    );

  }

}
