import {
  ModelCapability
} from "./ModelRouter";


export class CapabilityMatcher {


  detect(task:string): ModelCapability {

    const text = task.toLowerCase();


    if(text.includes("bug") ||
       text.includes("code")) {
      return "coding";
    }


    if(text.includes("design") ||
       text.includes("architecture")) {
      return "planning";
    }


    if(text.includes("security")) {
      return "security";
    }


    return "analysis";

  }

}
