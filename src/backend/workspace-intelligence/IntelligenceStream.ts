export class IntelligenceStream {


  emit(event:any){

    return {

      timestamp:Date.now(),

      event

    };

  }


}
