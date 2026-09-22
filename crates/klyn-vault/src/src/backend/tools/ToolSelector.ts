export class ToolSelector {


 select(
  tools:any[],
  intent:string
 ){

  return tools.find(
   tool =>
   intent
   .toLowerCase()
   .includes(
    tool.name.toLowerCase()
   )
  );

 }


}
