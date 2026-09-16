export class SelfRefactorSystem {
  refactor(component:string){
    return {
      component,
      refactored:false
    };
  }
}
