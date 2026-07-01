import { KlynOS } from "./packages/ai-orchestrator/src/KlynOS";

async function main() {
  const os = new KlynOS();

  const result = await os.run(
    "Test AI OS startup",
    "workspace-1"
  );

  console.log(JSON.stringify(result, null, 2));
}

main();
