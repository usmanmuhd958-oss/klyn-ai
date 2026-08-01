export interface IntelligenceModel {
    name:string;
    capability:string[];
    priority:number;
}

export class ModelFusionEngine {

    private models:IntelligenceModel[] = [];

    registerModel(model:IntelligenceModel){
        this.models.push(model);
    }

    getModels(){
        return this.models;
    }

    selectBest(capability:string){

        return this.models
        .filter(m => m.capability.includes(capability))
        .sort((a,b)=>b.priority-a.priority)[0];

    }
}
