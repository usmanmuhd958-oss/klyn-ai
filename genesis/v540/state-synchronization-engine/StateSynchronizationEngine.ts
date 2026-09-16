export class StateSynchronizationEngine {
  synchronize(states: unknown[]) {
    return {
      synchronizedStates: states.length
    };
  }
}
