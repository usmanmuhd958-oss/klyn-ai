export class SystemAudit {


inspect(component:string){

 return {
  component,
  status:"checked",
  timestamp:Date.now()
 };

}


}
