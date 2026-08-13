import {PairProgrammingEngine} from "./PairProgrammingEngine.js";
import {CodeCollaborationManager} from "./CodeCollaborationManager.js";
import {LiveSuggestionCoordinator} from "./LiveSuggestionCoordinator.js";


export class PairProgrammingController {


 engine=new PairProgrammingEngine();

 collaboration=new CodeCollaborationManager();

 suggestions=new LiveSuggestionCoordinator();



 execute(request:any){

   return {

     session:
       this.engine.start(request.session),

     collaboration:
       this.collaboration.collaborate(request.change),

     suggestions:
       this.suggestions.suggest(request.context)

   };


 }


}
