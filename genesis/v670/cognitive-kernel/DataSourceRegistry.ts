export class DataSourceRegistry {

 register(source:string){

  return {
   source,
   status:"connected"
  };

 }

}
