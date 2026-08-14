
export interface ConfidenceInput {

successProbability:number;

risk:number;

complexity:number;

}


export function calculateConfidence(
input:ConfidenceInput
){

const score =
(
input.successProbability * 0.6
+
(1-input.risk)*0.25
+
(1-input.complexity)*0.15
)
*100;


return Math.max(
0,
Math.min(
100,
Math.round(score)
)
);

}

