export class KnowledgeExplorer {

    explore(topic:string){

        return {
            topic,
            sources:[
                "knowledge-graph",
                "memory-store",
                "research-engine"
            ],
            status:"explored"
        };
    }
}
