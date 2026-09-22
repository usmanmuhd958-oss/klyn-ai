import {FrontendSchema} from "./FrontendSchema.js";
import {EndpointRegistry} from "./EndpointRegistry.js";
import {ContractValidator} from "./ContractValidator.js";


export class FrontendContractController {


 schema=new FrontendSchema();

 registry=new EndpointRegistry();

 validator=new ContractValidator();



 freeze(){

   const contract = {

     schema:
       this.schema.schema(),

     endpoints:
       this.registry.list()

   };


   return {

     contract,

     validation:
       this.validator.validate(contract),

     status:"frontend-ready"

   };

 }


}
