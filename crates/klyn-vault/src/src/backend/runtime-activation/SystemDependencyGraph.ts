export class SystemDependencyGraph {

  dependencies = [];

  add(service:string){

    this.dependencies.push(service);

  }

}
