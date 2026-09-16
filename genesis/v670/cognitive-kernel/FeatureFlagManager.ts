export class FeatureFlagManager {

 toggle(feature:string){
   return {
    feature,
    enabled:true
   };
 }

}
