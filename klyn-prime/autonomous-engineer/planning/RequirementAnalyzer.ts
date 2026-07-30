export interface Requirement {
  request: string;
  category: string;
  complexity: number;
}


export class RequirementAnalyzer {


  analyze(request: string): Requirement {

    return {
      request,
      category: "software-engineering",
      complexity: request.length
    };

  }

}
