export class CommunicationFabric {
  transmit(message:any){
    return {
      message,
      delivered:true
    };
  }
}
