export class SystemFutureForecastingEngine {
  forecast(state:any){
    return {
      state,
      prediction:"generated"
    };
  }
}
