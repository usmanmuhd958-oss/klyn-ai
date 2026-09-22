import { RepositoryScanner } from "./RepositoryScanner.js";
import { RepositoryIndexer } from "./RepositoryIndexer.js";


export class RepositoryBrainController {


 scanner =
  new RepositoryScanner();


 indexer =
  new RepositoryIndexer();



 understand(path:string){

  const files =
   this.scanner.scan(path);


  return this.indexer.index(files);

 }


}
