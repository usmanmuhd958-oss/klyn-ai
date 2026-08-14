
export type MutationAction =
  | "insert"
  | "replace"
  | "delete";

export interface MutationProposal {
  id: string;
  agentId: string;
  filePath: string;
  action: MutationAction;
  before: string;
  after: string;
  confidence: number;
  createdAt: number;
}

export interface MutationResult {
  accepted: boolean;
  proposalId: string;
  timestamp: number;
}


export class MutationEngine {

  private history: MutationProposal[] = [];

  propose(
    proposal: MutationProposal
  ): MutationProposal {

    this.history.push(proposal);

    return proposal;
  }


  accept(
    id:string
  ): MutationResult {

    return {
      accepted:true,
      proposalId:id,
      timestamp:Date.now()
    };

  }


  reject(
    id:string
  ): MutationResult {

    return {
      accepted:false,
      proposalId:id,
      timestamp:Date.now()
    };

  }


  getHistory(){

    return this.history;

  }

}

