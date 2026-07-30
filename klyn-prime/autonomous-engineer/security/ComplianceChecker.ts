export class ComplianceChecker {

  check(system: string) {

    return {
      compliant: true,
      standards: [
        "Security baseline"
      ]
    };

  }

}
