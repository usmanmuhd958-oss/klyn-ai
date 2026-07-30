export interface SelectionContext {
  task:string;
  capability:string;
}


export interface SelectedModel {
  model:string;
  reason:string;
}


export class DynamicSelector {


select(
 context:SelectionContext
):SelectedModel {


 if(context.capability === "security") {

  return {
   model:"security-specialist",
   reason:"high security requirement"
  };

 }


 if(context.capability === "coding") {

  return {
   model:"coding-specialist",
   reason:"software engineering task"
  };

 }


 return {
  model:"general-intelligence",
  reason:"general reasoning"
 };

}


}
