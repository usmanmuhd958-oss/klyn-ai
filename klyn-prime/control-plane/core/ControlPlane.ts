export interface SystemCommand {
  goal:string;
  priority:number;
}


export class ControlPlane {

async execute(command:SystemCommand){

 return {
   status:"accepted",
   goal:command.goal,
   priority:command.priority
 };

}

}
