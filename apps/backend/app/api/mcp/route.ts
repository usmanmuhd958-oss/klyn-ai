import { timingSafeEqual } from "node:crypto";
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import * as z from "zod";

export const runtime = "nodejs";
export const maxDuration = 60;

const serverFactory = () => {
  const server = new McpServer({
    name: "klyn-os-backend",
    version: "1.0.0",
  });

  server.registerTool(
    "klyn_system_health",
    {
      description: "Checks Klyn OS MCP gateway connectivity and status.",
      inputSchema: z.object({}),
    },
    async () => ({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            ok: true,
            status: "active",
            service: "klyn-os-mcp-gateway",
            timestamp: new Date().toISOString(),
          }),
        },
      ],
    })
  );

  return server;
};

const mcpHandler = createMcpHandler(serverFactory);

function isAuthorized(request: Request): boolean {
  const auth = request.headers.get("authorization");
  const match = auth?.match(/^Bearer\s+(\S+)$/i);
  if (!match) return false;

  const envTokens = process.env.KLYN_MCP_TOKENS_JSON;
  if (!envTokens) return false;

  try {
    const tokens = JSON.parse(envTokens);
    const supplied = Buffer.from(match[1], "utf8");

    return tokens.some((t: { token: string }) => {
      const expected = Buffer.from(t.token, "utf8");
      return supplied.length === expected.length && timingSafeEqual(supplied, expected);
    });
  } catch {
    return false;
  }
}

async function handleRequest(request: Request): Promise<Response> {
  if (!isAuthorized(request)) {
    return new Response("Unauthorized MCP Gateway Access", {
      status: 401,
      headers: { "Cache-Control": "no-store" },
    });
  }

  try {
    return await mcpHandler.fetch(request);
  } catch (error: unknown) {
    console.error("MCP Execution Error:", error);
    return new Response("Internal MCP Server Error", {
      status: 500,
      headers: { "Cache-Control": "no-store" },
    });
  }
}

export const GET = handleRequest;
export const POST = handleRequest;
export const DELETE = handleRequest;
