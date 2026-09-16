export class CrossLayerCommunication {
  send(source: string, target: string, message: string) {
    return {
      source,
      target,
      message
    };
  }
}
