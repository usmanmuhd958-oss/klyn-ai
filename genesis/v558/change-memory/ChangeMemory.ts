export class ChangeMemory {
  store(change:string){
    return {
      change,
      remembered:true
    };
  }
}
