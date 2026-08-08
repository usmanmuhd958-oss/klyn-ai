export class LayerCommunication {

  send(source:string,target:string,message:string){
    return {
      source,
      target,
      message
    };
  }

}
