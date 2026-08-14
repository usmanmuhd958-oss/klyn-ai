import type {
 UserPresence,
 AuditEvent
} from "@/types/collaboration.types";


const presenceStore = new Map<string,UserPresence>();

const auditStore:AuditEvent[]=[];


export function updatePresence(
 user:UserPresence
){
 presenceStore.set(user.userId,user);
}


export function getPresence(){
 return Array.from(
  presenceStore.values()
 );
}


export function recordAudit(
 event:AuditEvent
){
 auditStore.push(event);
}


export function getAuditTrail(){
 return auditStore;
}
