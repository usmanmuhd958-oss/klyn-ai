export interface DebugEvent {

id:string;

error:string;

source:string;

severity:
"low"|
"medium"|
"high"|
"critical";

timestamp:number;

}


export interface DebugInsight {

cause:string;

confidence:number;

recommendation:string;

}
