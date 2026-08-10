export class EnterpriseReleaseCoordinator {

  coordinate(release:any){
    return {
      status:"enterprise_release_coordinated",
      release
    };
  }

}
