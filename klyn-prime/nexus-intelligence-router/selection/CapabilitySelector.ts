export interface Capability {

 id:string;

 name:string;

 score:number;

}


export class CapabilitySelector {


 private capabilities:Capability[];



 constructor(){

  this.capabilities=[];

 }



 addCapability(
 capability:Capability
 ){

  this.capabilities.push(
    capability
  );

 }



 select(
 required:string
 ){

  const matches =
  this.capabilities
  .filter(
    c =>
    c.name.includes(required)
  );


  if(matches.length===0){

    return null;

  }


  return matches.sort(
    (a,b)=>
    b.score-a.score

  )[0];

 }



 list(){

  return this.capabilities;

 }

}
