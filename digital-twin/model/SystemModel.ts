export type SystemComponent = {
  id: string;
  name: string;
  type:
    | "service"
    | "agent"
    | "database"
    | "module";

  dependencies: string[];
};


export class SystemModel {

  private components =
    new Map<string, SystemComponent>();


  register(
    component: SystemComponent
  ) {
    this.components.set(
      component.id,
      component
    );
  }


  get(id:string) {
    return this.components.get(id);
  }


  all() {
    return [
      ...this.components.values()
    ];
  }
}
