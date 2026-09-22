export class RuntimeCommandCenter {

  async execute(command:any){

    return {
      command,
      status:"accepted"
    };

  }

}
