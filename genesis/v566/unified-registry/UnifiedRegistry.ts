export class UnifiedRegistry {
  register(component:any){
    return {
      component,
      registered:true
    };
  }
}
