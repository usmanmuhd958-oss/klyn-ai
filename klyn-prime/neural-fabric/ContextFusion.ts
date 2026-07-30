export interface ContextData {
  source: string;
  content: string;
}


export class ContextFusion {

  fuse(contexts: ContextData[]) {

    return {
      combined:
        contexts.map(c => c.content).join("\n"),
      sources:
        contexts.map(c => c.source)
    };

  }

}
