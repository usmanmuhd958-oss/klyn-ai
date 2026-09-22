export class TraceCollector {


  trace(event:any){

    return {

      traced:true,

      event

    };

  }


}
