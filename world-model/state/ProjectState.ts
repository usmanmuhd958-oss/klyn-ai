export type ProjectEntity = {
  id: string;
  type: "file" | "module" | "service" | "agent";
  name: string;
  path?: string;
};


export class ProjectState {

  private entities = new Map<string, ProjectEntity>();


  register(entity: ProjectEntity) {
    this.entities.set(entity.id, entity);
  }


  remove(id: string) {
    this.entities.delete(id);
  }


  get(id: string) {
    return this.entities.get(id);
  }


  list() {
    return Array.from(this.entities.values());
  }
}
