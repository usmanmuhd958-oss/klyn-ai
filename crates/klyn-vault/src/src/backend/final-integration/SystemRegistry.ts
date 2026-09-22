export class SystemRegistry {

  private systems = new Map<string, any>();


  register(name:string, system:any){

    this.systems.set(name, system);

  }


  list(){

    return Array.from(this.systems.keys());

  }

}
