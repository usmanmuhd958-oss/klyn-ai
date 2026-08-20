export interface CuriositySignal {
  id: string;

  question: string;

  priority: number;

  createdAt: Date;
}


export class CuriosityEngine {

  private signals: CuriositySignal[] = [];


  generate(
    observation: string
  ): CuriositySignal {

    const signal: CuriositySignal = {
      id: crypto.randomUUID(),

      question:
        `Need more understanding about: ${observation}`,

      priority: 0.5,

      createdAt: new Date()
    };


    this.signals.push(signal);

    return signal;
  }


  getSignals(): CuriositySignal[] {

    return this.signals;
  }


  clear(): void {

    this.signals = [];
  }
}
