export class ProvenanceMemory {
  track(event:any){
    return {
      event,
      provenance:true
    };
  }
}
