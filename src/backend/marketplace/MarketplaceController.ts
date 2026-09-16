import { PlanManager } from "./PlanManager.js";
import { SubscriptionManager } from "./SubscriptionManager.js";


export class MarketplaceController {

 plans =
  new PlanManager();


 subscriptions =
  new SubscriptionManager();


 createCustomerSubscription(
  user:string,
  plan:string
 ){

  return this.subscriptions.subscribe(
   user,
   plan
  );

 }

}
