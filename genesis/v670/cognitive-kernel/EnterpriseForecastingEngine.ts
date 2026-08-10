export class EnterpriseForecastingEngine {

  forecast(data:any){
    return {
      status:"forecasting_active",
      data
    };
  }

}
