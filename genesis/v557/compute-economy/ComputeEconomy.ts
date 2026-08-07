export class ComputeEconomy {
  allocate(cpu:number,memory:number){
    return {
      cpu,
      memory,
      allocation:"balanced"
    };
  }
}
