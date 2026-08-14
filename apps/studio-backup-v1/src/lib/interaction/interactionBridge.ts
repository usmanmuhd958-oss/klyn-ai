export function emitInteraction(event:string){

return {
event,
time:Date.now(),
accepted:true
};

}
