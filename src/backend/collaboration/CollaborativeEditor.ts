export class CollaborativeEditor {


 applyChange(
  file:string,
  change:string
 ){

  return {

   file,

   change,

   applied:true

  };

 }


}
