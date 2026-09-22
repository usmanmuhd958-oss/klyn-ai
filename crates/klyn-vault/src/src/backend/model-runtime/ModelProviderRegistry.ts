export class ModelProviderRegistry {

  private providers = new Map<string, any>();


  register(name:string, provider:any){

    this.providers.set(name, provider);

  }


  get(name:string){

    return this.providers.get(name);

  }


  list(){

    return [...this.providers.keys()];

  }

}
