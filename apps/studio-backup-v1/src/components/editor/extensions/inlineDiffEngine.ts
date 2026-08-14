import {InlineDiff} from "../editor.types";


export class InlineDiffEngine {


private diffs:InlineDiff[]=[];


add(diff:InlineDiff){

this.diffs.push(diff);

}


get(){

return this.diffs;

}


accept(id:string){

this.diffs =
this.diffs.map(diff=>
diff.id===id
?
{
...diff,
status:"accepted"
}
:
diff
);

}


reject(id:string){

this.diffs =
this.diffs.map(diff=>
diff.id===id
?
{
...diff,
status:"rejected"
}
:
diff
);

}


}
