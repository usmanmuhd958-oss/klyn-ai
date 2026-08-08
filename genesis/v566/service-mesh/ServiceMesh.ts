export class ServiceMesh {
  connect(services:any[]){
    return {
      services,
      connected:true
    };
  }
}
