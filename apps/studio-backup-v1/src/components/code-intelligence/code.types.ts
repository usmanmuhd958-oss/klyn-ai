export interface CodeNode {

  id:string;

  type:
    | "file"
    | "function"
    | "class"
    | "component"
    | "service";

  name:string;

  path:string;

  dependencies:string[];

}


export interface CodeMutation {

  id:string;

  nodeId:string;

  operation:
    | "create"
    | "update"
    | "delete";

  status:
    | "proposed"
    | "streaming"
    | "accepted"
    | "rejected";

}
