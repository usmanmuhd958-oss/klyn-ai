export class IntrospectionMemory {

  records:any[]=[];

  store(event:any){
    this.records.push(event);
  }

  recall(){
    return this.records;
  }
}
