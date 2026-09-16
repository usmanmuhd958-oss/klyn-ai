export class EventPropagationEngine {
  propagate(event: string, targets: string[]) {
    return {
      event,
      targets
    };
  }
}
