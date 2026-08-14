
export interface CollaborationMessage{

type:
"presence" |
"cursor" |
"audit";

payload:unknown;

time:number;

}


export function publishCollaboration(
message:CollaborationMessage
){

return {

accepted:true,

message

};

}

