export class RuntimeManager {

  initialize(){

    return {
      initialized:true,
      status:"READY"
    };

  }


  private status = "CREATED";

  start(){
    this.status = "RUNNING";

    return {
      status:this.status,
      started:true
    };
  }


  health(){
    return {
      runtime:this.status
    };
  }

}
