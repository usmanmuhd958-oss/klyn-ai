export class MissionControl {
  execute(mission:string){
    return {
      mission,
      status:"active"
    };
  }
}
