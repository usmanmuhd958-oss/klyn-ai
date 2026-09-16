export class RuntimeEventBus {

  emit(event:string){
    return {
      event,
      delivered:true
    };
  }

}
