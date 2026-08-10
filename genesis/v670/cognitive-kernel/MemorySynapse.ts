export class MemorySynapse {

  private memories:any[] = [];


  remember(data:any){

    this.memories.push({
      timestamp: Date.now(),
      data
    });

  }


  recall(query:string){

    return this.memories.filter(
      item =>
      JSON.stringify(item)
      .toLowerCase()
      .includes(query.toLowerCase())
    );

  }


  stats(){

    return {
      total:
      this.memories.length,
      status:"active"
    };

  }

}
