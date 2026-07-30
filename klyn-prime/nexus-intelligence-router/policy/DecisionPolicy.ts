export class DecisionPolicy {


 evaluate(
  decision:any
 ){

  const approved =
  decision
  &&
  decision.agent
  &&
  decision.capability;


  return {

    approved,

    timestamp:
    Date.now(),

    reason:
    approved
    ?
    "Policy accepted"
    :
    "Missing required fields"

  };

 }


}
