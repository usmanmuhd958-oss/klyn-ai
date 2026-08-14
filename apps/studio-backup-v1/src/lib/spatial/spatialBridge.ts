export function emitSpatialEvent(
type:string,
payload:unknown
){

return {
type,
payload,
timestamp:Date.now()
};

}
