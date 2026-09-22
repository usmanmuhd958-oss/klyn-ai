export class CircuitBreaker {

 private open=false;


 execute(task:Function){

  if(this.open){

   throw new Error("Circuit open");

  }

  return task();

 }

}
