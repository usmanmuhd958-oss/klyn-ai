export class AutonomousDeveloperOrganizationRuntime {
  execute(project:any){
    return {
      project,
      lifecycle:"running"
    };
  }
}
