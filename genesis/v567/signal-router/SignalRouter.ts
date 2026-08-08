export class SignalRouter {
  route(signal:any){
    return {
      signal,
      routed:true
    };
  }
}
