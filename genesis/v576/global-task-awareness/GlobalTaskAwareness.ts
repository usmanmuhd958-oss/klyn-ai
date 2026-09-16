export class GlobalTaskAwareness {
  analyze(tasks:any[]){
    return {
      tasks,
      awareness:"enabled"
    };
  }
}
