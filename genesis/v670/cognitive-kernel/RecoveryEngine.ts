export class RecoveryEngine {
  recover(error: any) {
    return {
      recovered: true,
      error
    };
  }
}
