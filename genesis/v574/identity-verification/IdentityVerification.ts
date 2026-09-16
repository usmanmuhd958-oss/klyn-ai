export class IdentityVerification {
  verify(identity:any){
    return {
      identity,
      verified:false
    };
  }
}
