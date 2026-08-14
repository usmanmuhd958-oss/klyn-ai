
export interface TestingEvent {

type:
"test:generated"
|
"test:validated";

payload:
unknown;

}


export function emitTestingEvent(
event:TestingEvent
){

console.log(
"KLYN TEST EVENT",
event
);

}

