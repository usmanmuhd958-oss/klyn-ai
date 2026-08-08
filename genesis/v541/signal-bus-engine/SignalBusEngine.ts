export class SignalBusEngine {
  emit(signal: string) {
    return {
      signal,
      delivered: true
    };
  }
}
