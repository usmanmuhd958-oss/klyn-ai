import {AgentExperienceCollector} from "./AgentExperienceCollector.js";
import {ExperienceRepository} from "./ExperienceRepository.js";
import {PerformanceAnalyzer} from "./PerformanceAnalyzer.js";
import {AgentLearningEngine} from "./AgentLearningEngine.js";
import {SkillImprovementEngine} from "./SkillImprovementEngine.js";


export class LearningController {

  private collector =
    new AgentExperienceCollector();

  private repository =
    new ExperienceRepository();

  private analyzer =
    new PerformanceAnalyzer();

  private learner =
    new AgentLearningEngine();

  private skill =
    new SkillImprovementEngine();



  learn(agent:string,result:any){

    const experience =
      this.collector.collect(agent,result);


    this.repository.save(experience);


    const analysis =
      this.analyzer.analyze(experience);


    const improvement =
      this.learner.learn(analysis);


    return this.skill.improve(improvement);

  }

}
