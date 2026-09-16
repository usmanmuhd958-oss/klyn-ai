export class CommandLayer {
  execute(command:string){
    return {
      command,
      executed:true
    };
  }
}
