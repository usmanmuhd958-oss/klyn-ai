export type EditorLanguage =
 | "typescript"
 | "javascript"
 | "json"
 | "css"
 | "html"
 | "markdown"
 | "python"
 | "sql"
 | "shell"
 | "plaintext";

export interface EditorDocument {
 id:string;
 uri:string;
 filePath:string;
 language:EditorLanguage;
 content:string;
 version:number;
 updatedAt:number;
}

export type MutationStatus =
 "pending" |
 "accepted" |
 "rejected";

export interface InlineDiff {
 id:string;
 documentId:string;
 original:string;
 proposed:string;
 source:string;
 ts:number;
 status:MutationStatus;
}

export interface CodeMutation {
 id:string;
 documentId:string;
 kind:"insert"|"replace"|"delete";
 content:string;
 source:string;
 status:MutationStatus;
}
