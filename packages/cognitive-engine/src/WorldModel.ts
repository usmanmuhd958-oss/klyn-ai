export interface WorldEntity {
  id: string;
  type: 
    | "file"
    | "module"
    | "service"
    | "dependency"
    | "runtime";

  name: string;

  metadata: Record<string, unknown>;
}


export interface WorldRelationship {
  from: string;
  to: string;
  relation:
    | "depends_on"
    | "imports"
    | "calls"
    | "contains";
}


export interface WorldModel {
  entities: WorldEntity[];

  relationships: WorldRelationship[];

  lastUpdated: Date;
}


export class WorldModelEngine {

  private model: WorldModel;


  constructor() {

    this.model = {
      entities: [],
      relationships: [],
      lastUpdated: new Date()
    };

  }


  addEntity(entity: WorldEntity): void {

    this.model.entities.push(entity);

    this.touch();
  }


  addRelationship(
    relationship: WorldRelationship
  ): void {

    this.model.relationships.push(
      relationship
    );

    this.touch();
  }


  getModel(): WorldModel {

    return this.model;

  }


  private touch(): void {

    this.model.lastUpdated = new Date();

  }

}
