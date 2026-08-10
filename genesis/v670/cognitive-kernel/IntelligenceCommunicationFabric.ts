export class IntelligenceCommunicationFabric {

  transmit(message:string){
    return {
      message,
      delivered:true
    };
  }

}
