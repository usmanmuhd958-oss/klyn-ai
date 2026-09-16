export class VerificationEngine {

  verify(output: unknown) {

    return {
      passed: output !== undefined,
      issues: []
    };

  }

}
