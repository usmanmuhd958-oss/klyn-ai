export class CircuitBreaker {


 private failures = 0;


 recordFailure(){

  this.failures++;

 }


 state(){

  return this.failures > 5
   ? "OPEN"
   : "CLOSED";

 }


}
