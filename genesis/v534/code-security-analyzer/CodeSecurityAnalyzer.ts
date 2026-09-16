export class CodeSecurityAnalyzer {
  scan(repository:any){
    return {
      repository,
      findings:[]
    }
  }
}
