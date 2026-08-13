import {ModuleVerifier} from "./ModuleVerifier.js";
import {RuntimeFlowTester} from "./RuntimeFlowTester.js";
import {IntelligenceFlowTester} from "./IntelligenceFlowTester.js";


export class IntegrationController {


 modules=new ModuleVerifier();

 runtime=new RuntimeFlowTester();

 intelligence=new IntelligenceFlowTester();



 verify(input:any){

   return {

     module:
       this.modules.verify(input.module),

     runtime:
       this.runtime.test(input.flow),

     intelligence:
       this.intelligence.test(input.intent),

     status:"integration-ready"

   };

 }


}
