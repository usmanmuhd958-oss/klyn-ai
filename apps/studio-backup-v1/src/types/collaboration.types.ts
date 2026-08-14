export interface UserPresence {
 id:string;
 userId:string;
 name:string;
 cursor?:{
  x:number;
  y:number;
 };
 status:"online"|"away"|"offline";
 lastSeen:number;
}

export interface CollaborationPermission {
 userId:string;
 role:"owner"|"admin"|"developer"|"viewer";
 permissions:string[];
}

export interface AuditEvent {
 id:string;
 actor:string;
 action:string;
 resource:string;
 timestamp:number;
 metadata?:Record<string,unknown>;
}
