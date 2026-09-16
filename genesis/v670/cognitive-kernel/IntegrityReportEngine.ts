export class IntegrityReportEngine {

  generate(report:any) {
    return {
      system: "KLYN PRIME",
      integrity: report
    };
  }

}
