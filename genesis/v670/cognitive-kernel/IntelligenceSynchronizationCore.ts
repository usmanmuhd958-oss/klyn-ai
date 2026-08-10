export class IntelligenceSynchronizationCore {

  synchronize(intelligence:any){
    return {
      status:"intelligence_synchronized",
      intelligence
    };
  }

}
