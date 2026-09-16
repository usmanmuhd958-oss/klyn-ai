import { spawn } from "node:child_process";

console.log("[KLYN INDEX WORKER] START");

const child = spawn(
  "node",
  ["-e", `
    import("./klyn_server.js")
      .then(async m => {
        console.log("[WORKER] READY");
      })
  `],
  {
    stdio: "inherit"
  }
);

child.on("exit", code => {
  console.log("[WORKER EXIT]", code);
});
