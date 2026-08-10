import { ExperienceCollector } from "./ExperienceCollector";
import { PerformanceAnalyzer } from "./PerformanceAnalyzer";
import { StrategyOptimizer } from "./StrategyOptimizer";

export class LearningController {

 learn(agent:string, action:string, result:any){

   const exp =
    new ExperienceCollector()
    .collect(agent,action,result);

   const score =
    new PerformanceAnalyzer()
    .evaluate(exp);

   return new StrategyOptimizer()
    .optimize(score);

 }

}
