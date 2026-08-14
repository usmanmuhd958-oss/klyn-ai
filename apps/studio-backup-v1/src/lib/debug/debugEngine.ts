import type {
DebugEvent,
DebugInsight
} from "@/types/debug/debug.types";


const errors:DebugEvent[]=[];


export function captureError(
event:DebugEvent
){

errors.push(event);

}


export function analyzeError(
event:DebugEvent
):DebugInsight{


return {

cause:
"Pattern analysis required",

confidence:
0.5,

recommendation:
"Inspect runtime context"

};

}


export function getDebugHistory(){

return errors;

}
