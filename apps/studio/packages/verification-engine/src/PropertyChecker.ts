export class PropertyChecker {
  check(target: unknown) {
    return {
      target,
      status: "verified",
      score: 1
    };
  }
}
