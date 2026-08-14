export function emitMemoryEvent(
event:string,
payload:unknown
){

return {
event,
payload,
timestamp:Date.now()
};

}
