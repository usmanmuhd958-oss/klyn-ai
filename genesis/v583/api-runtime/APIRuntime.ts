export class APIRuntime {
  handle(request: unknown) {
    return {
      status: "processed",
      request
    };
  }
}
