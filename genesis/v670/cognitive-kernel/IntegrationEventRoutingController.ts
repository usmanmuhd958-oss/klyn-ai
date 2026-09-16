export class IntegrationEventRoutingController {

  route(event:any){
    return {
      status:"event_routing_active",
      event
    };
  }

}
