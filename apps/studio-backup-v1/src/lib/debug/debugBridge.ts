export function emitDebugEvent(
error:string
){

return {

error,

timestamp:Date.now(),

};

}
