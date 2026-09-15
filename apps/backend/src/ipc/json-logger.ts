export interface JsonLogger {
  info(event: string, fields?: Record<string, unknown>): void;
  error(event: string, fields?: Record<string, unknown>): void;
}

function write(level: "info" | "error", event: string, fields: Record<string, unknown> = {}): void {
  const record = {
    timestamp: new Date().toISOString(),
    level,
    service: "klyn-backend",
    component: "json-rpc",
    event,
    ...fields,
  };
  const line = JSON.stringify(record);
  if (level === "error") console.error(line);
  else console.log(line);
}

export const jsonLogger: JsonLogger = {
  info: (event, fields) => write("info", event, fields),
  error: (event, fields) => write("error", event, fields),
};
