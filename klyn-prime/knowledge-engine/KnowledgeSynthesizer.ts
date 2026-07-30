export interface KnowledgeItem {
  source: string;
  information: string;
}


export class KnowledgeSynthesizer {

  synthesize(items: KnowledgeItem[]) {

    return {
      knowledge:
        items.map(i => i.information).join("\n"),

      sources:
        items.map(i => i.source),

      confidence: 0.5
    };

  }

}
