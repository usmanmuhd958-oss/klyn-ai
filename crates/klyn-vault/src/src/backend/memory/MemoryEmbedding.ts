export class MemoryEmbedding {


 generate(text:string){

  const vector:number[]=[];


  for(
   const char of text
  ){

   vector.push(
    char.charCodeAt(0)
   );

  }


  return vector.slice(0,128);

 }


}
