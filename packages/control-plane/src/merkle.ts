import { sha256 } from "./crypto.js";
import { newCheckpointId } from "./ids.js";
import type { CheckpointId, Hash256, LedgerEvent, MissionId } from "./types.js";

export interface MerkleCheckpoint {
  readonly checkpointId: CheckpointId;
  readonly missionId: MissionId;
  readonly firstSequence: bigint;
  readonly lastSequence: bigint;
  readonly leafCount: number;
  readonly rootHash: Hash256;
}

export class MerkleCheckpointEngine {
  async create(missionId: MissionId, events: readonly LedgerEvent[]): Promise<MerkleCheckpoint> {
    if (events.length === 0) throw new Error("MERKLE_CHECKPOINT_REQUIRES_EVENTS");
    const sorted = [...events].sort((a, b) => Number(a.sequence - b.sequence));
    let layer = sorted.map((event) => event.eventHash as string);
    while (layer.length > 1) {
      const next: string[] = [];
      for (let i = 0; i < layer.length; i += 2) {
        const left = layer[i];
        const right = layer[i + 1] ?? left;
        next.push(await sha256(`${left}${right}`));
      }
      layer = next;
    }
    return {
      checkpointId: newCheckpointId(),
      missionId,
      firstSequence: sorted[0]!.sequence,
      lastSequence: sorted[sorted.length - 1]!.sequence,
      leafCount: sorted.length,
      rootHash: layer[0] as Hash256,
    };
  }

  async verify(checkpoint: MerkleCheckpoint, events: readonly LedgerEvent[]): Promise<boolean> {
    const candidates = events.filter((event) => event.sequence >= checkpoint.firstSequence && event.sequence <= checkpoint.lastSequence);
    const rebuilt = await this.create(checkpoint.missionId, candidates);
    return rebuilt.leafCount === checkpoint.leafCount && rebuilt.firstSequence === checkpoint.firstSequence && rebuilt.lastSequence === checkpoint.lastSequence && rebuilt.rootHash === checkpoint.rootHash;
  }
}
