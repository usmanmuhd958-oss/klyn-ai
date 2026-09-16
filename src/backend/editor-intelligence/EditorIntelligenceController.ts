import {CodeUnderstandingEngine} from "./CodeUnderstandingEngine.js";
import {ContextAnalyzer} from "./ContextAnalyzer.js";
import {SuggestionEngine} from "./SuggestionEngine.js";
import {RefactoringAdvisor} from "./RefactoringAdvisor.js";


export class EditorIntelligenceController {

  understanding=new CodeUnderstandingEngine();

  context=new ContextAnalyzer();

  suggestions=new SuggestionEngine();

  refactor=new RefactoringAdvisor();


  analyze(request:any){

    return {

      code:
      this.understanding.analyze(request.code || ""),

      context:
      this.context.analyze(request.context || {}),

      suggestions:
      this.suggestions.suggest(request),

      refactoring:
      this.refactor.advise(request.code)

    };

  }

}
