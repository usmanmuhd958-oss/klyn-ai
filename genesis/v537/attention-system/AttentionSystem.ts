export class AttentionSystem {

  focus:any = null;

  allocate(target:any){
    this.focus = target;

    return {
      attention:"allocated",
      target
    };
  }

  current(){
    return this.focus;
  }
}
