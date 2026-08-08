export class ExperienceFederation {
  share(experiences:any[]){
    return {
      experiences,
      federated:true
    };
  }
}
