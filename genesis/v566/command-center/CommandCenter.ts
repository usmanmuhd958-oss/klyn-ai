export class CommandCenter {
  execute(command:string){
    return {
      command,
      executed:true
    };
  }
}
