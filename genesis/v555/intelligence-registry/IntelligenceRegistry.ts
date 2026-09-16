export class IntelligenceRegistry {

  register(component:string){
    return {
      component,
      registered:true
    };
  }

}
