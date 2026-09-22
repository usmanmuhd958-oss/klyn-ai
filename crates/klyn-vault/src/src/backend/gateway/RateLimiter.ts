export class RateLimiter {


 private requests =
  new Map<string,number>();


 allow(id:string){

  const count =
   this.requests.get(id) || 0;


  this.requests.set(
   id,
   count + 1
  );


  return true;

 }


}
