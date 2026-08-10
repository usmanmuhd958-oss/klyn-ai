export class ExecutionEventBus {
  emit(event: string, payload: any) {
    return {
      event,
      payload
    };
  }
}
