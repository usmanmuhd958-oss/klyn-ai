export interface EvolutionProposal {
  area: string;
  improvement: string;
  confidence: number;
}


export class EvolutionController {

  private proposals: EvolutionProposal[] = [];


  propose(
    area: string,
    improvement: string
  ) {

    const proposal = {
      area,
      improvement,
      confidence: 0.5
    };

    this.proposals.push(proposal);

    return proposal;
  }


  getProposals() {
    return this.proposals;
  }

}
