import type {UserIntent,AgentAction} from "@/types/interaction.types";

export function analyzeIntent(
intent:UserIntent
):AgentAction{

return {
id:crypto.randomUUID(),
action:`execute:${intent.command}`,
confidence:0.98
};

}
