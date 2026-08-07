export class WorldModel {

  entities:any[]=[];

  observe(data:any){
    this.entities.push(data);
  }

  predict(){
    return this.entities;
  }
}
