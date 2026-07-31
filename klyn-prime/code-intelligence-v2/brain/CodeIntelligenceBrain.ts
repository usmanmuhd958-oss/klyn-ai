/**
 * KLYN Prime Code Intelligence v2
 *
 * Central Brain Orchestrator
 *
 * Coordinates all code intelligence systems.
 */


import { ProjectKnowledgeGraph } 
from "../graph/ProjectKnowledgeGraph";


import { ParserEngine } 
from "../parser/ParserEngine";


import { SemanticAnalyzer } 
from "../analysis/SemanticAnalyzer";


import { EngineeringMemory } 
from "../memory/EngineeringMemory";


import { RecommendationEngine } 
from "../recommendation/RecommendationEngine";





export interface BrainScanRequest {

    filePath:string;

    language:string;

    source:string;

}





export interface IntelligenceResult {

    file:string;

    symbols:number;

    issues:number;

    recommendations:number;

    timestamp:number;

}







export class CodeIntelligenceBrain {



    private graph:ProjectKnowledgeGraph;

    private parser:ParserEngine;

    private analyzer:SemanticAnalyzer;

    private memory:EngineeringMemory;

    private recommender:RecommendationEngine;





    constructor(){


        this.graph =
            new ProjectKnowledgeGraph();



        this.parser =
            new ParserEngine();



        this.analyzer =
            new SemanticAnalyzer();



        this.memory =
            new EngineeringMemory();



        this.recommender =
            new RecommendationEngine();


    }








    scan(
        request:BrainScanRequest
    ):IntelligenceResult {



        const parsed =
            this.parser.parse({

                filePath:
                    request.filePath,

                language:
                    request.language,

                content:
                    request.source

            });





        const analysis =
            this.analyzer.analyze({

                filePath:
                    request.filePath,

                language:
                    request.language,

                source:
                    request.source

            });






        this.graph.addNode({

            id:
                request.filePath,


            name:
                request.filePath,


            type:
                "file",


            metadata:
                {

                    language:
                        request.language,

                    symbols:
                        parsed.symbols.length

                }

        });







        const recommendations =
            this.recommender.generate({

                fileCount:
                    this.graph.analyzeArchitecture()
                        .totalNodes,


                issueCount:
                    analysis.issues.length,


                architectureScore:
                    analysis.score,


                memoryMatches:
                    this.memory
                    .exportKnowledge()
                    .length

            });







        this.memory.learn(

            "architecture",

            `Analysis completed: ${request.filePath}`,

            "KLYN analyzed this file and stored engineering knowledge."

        );







        return {


            file:
                request.filePath,


            symbols:
                parsed.symbols.length,


            issues:
                analysis.issues.length,


            recommendations:
                recommendations.length,


            timestamp:
                Date.now()

        };


    }






    getSystemState(){


        return {


            graph:
                this.graph.analyzeArchitecture(),


            memory:
                this.memory.exportKnowledge().length,


            recommendations:
                this.recommender.getAll().length


        };


    }



}
