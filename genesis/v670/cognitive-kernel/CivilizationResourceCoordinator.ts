export class CivilizationResourceCoordinator {

  coordinate(resources:any[]){
    return {
      status:"resource_coordination_active",
      resources
    };
  }

}
