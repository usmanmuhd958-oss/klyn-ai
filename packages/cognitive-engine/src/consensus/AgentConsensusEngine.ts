export interface ConsensusVote<T = unknown> {
  readonly nodeId: string;
  readonly term: number;
  readonly revision: number;
  readonly state: T;
}

export interface ConsensusDecision<T = unknown> {
  readonly term: number;
  readonly revision: number;
  readonly quorum: number;
  readonly voters: readonly string[];
  readonly state: Readonly<T>;
}

export interface ConsensusProposal<T = unknown> {
  readonly term: number;
  readonly revision: number;
  readonly state: T;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

/** Lightweight quorum protocol with monotonic terms/revisions and deterministic majority agreement. */
export class AgentConsensusEngine<T = unknown> {
  private currentTerm = 0;
  private readonly votes = new Map<string, ConsensusVote<T>>();

  constructor(private readonly clusterSize: number) {
    if (!Number.isInteger(clusterSize) || clusterSize < 1) throw new Error("clusterSize must be a positive integer");
  }

  get quorumSize(): number { return Math.floor(this.clusterSize / 2) + 1; }

  beginProposal(proposal: ConsensusProposal<T>): void {
    if (proposal.term < this.currentTerm) throw new Error("Stale consensus term");
    if (!Number.isInteger(proposal.revision) || proposal.revision < 0) throw new Error("Invalid consensus revision");
    this.currentTerm = proposal.term;
    this.votes.clear();
  }

  castVote(vote: ConsensusVote<T>): void {
    if (vote.term < this.currentTerm) throw new Error("Stale consensus term");
    if (vote.term > this.currentTerm) { this.currentTerm = vote.term; this.votes.clear(); }
    if (!vote.nodeId.trim()) throw new Error("nodeId must not be empty");
    if (!Number.isInteger(vote.revision) || vote.revision < 0) throw new Error("Invalid consensus revision");
    this.votes.set(vote.nodeId, Object.freeze({ ...vote, state: clone(vote.state) }));
  }

  decide(): ConsensusDecision<T> | undefined {
    const eligible = [...this.votes.values()].filter((vote) => vote.term === this.currentTerm);
    if (eligible.length < this.quorumSize) return undefined;
    const groups = new Map<string, { revision: number; state: T; voters: string[] }>();
    for (const vote of eligible) {
      const key = `${vote.revision}:${JSON.stringify(vote.state)}`;
      const group = groups.get(key) ?? { revision: vote.revision, state: vote.state, voters: [] };
      group.voters.push(vote.nodeId);
      groups.set(key, group);
    }
    const winner = [...groups.values()]
      .filter((group) => group.voters.length >= this.quorumSize)
      .sort((a, b) => b.voters.length - a.voters.length || b.revision - a.revision || a.voters.slice().sort()[0].localeCompare(b.voters.slice().sort()[0]))[0];
    if (!winner) return undefined;
    const voters = Object.freeze(winner.voters.slice().sort());
    return Object.freeze({ term: this.currentTerm, revision: winner.revision, quorum: voters.length, voters, state: clone(winner.state) as Readonly<T> });
  }

  reset(): void { this.votes.clear(); }
}
