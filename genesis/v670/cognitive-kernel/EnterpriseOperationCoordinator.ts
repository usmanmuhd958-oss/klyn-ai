export class EnterpriseOperationCoordinator {

  coordinate(operation:any){
    return {
      status:"operation_coordinated",
      operation
    };
  }

}
