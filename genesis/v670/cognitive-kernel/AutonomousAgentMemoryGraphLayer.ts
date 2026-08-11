export class AutonomousAgentMemoryGraphLayer {
  remember(data:any){
    return {
      data,
      memory:"connected"
    };
  }
}
