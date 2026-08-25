import { WebSocketServer, WebSocket } from "ws";

export interface SocketClient {
  id: string;
  workspaceId: string;
  socket: WebSocket;
}

export interface RealtimeMessage {
  type: string;
  payload: unknown;
}

class KlynWebSocketServer {
  private server: WebSocketServer | null = null;
  private clients: Map<string, SocketClient> = new Map();

  initialize(port: number) {
    if (this.server) {
      return;
    }

    this.server = new WebSocketServer({ port });

    this.server.on("connection", (socket) => {
      const clientId = crypto.randomUUID();

      const client: SocketClient = {
        id: clientId,
        workspaceId: "",
        socket,
      };

      this.clients.set(clientId, client);

      socket.on("message", (raw) => {
        try {
          const message = JSON.parse(raw.toString());
          this.handleMessage(clientId, message);
        } catch (error) {
          console.error("Invalid websocket message", error);
        }
      });

      socket.on("close", () => {
        this.clients.delete(clientId);
      });
    });
  }

  private handleMessage(clientId: string, message: RealtimeMessage) {
    const client = this.clients.get(clientId);

    if (!client) {
      return;
    }

    if (message.type === "workspace.join") {
      client.workspaceId = String(
        (message.payload as Record<string, unknown>).workspaceId
      );
    }
  }

  broadcast(workspaceId: string, message: RealtimeMessage) {
    for (const client of this.clients.values()) {
      if (
        client.workspaceId === workspaceId &&
        client.socket.readyState === WebSocket.OPEN
      ) {
        client.socket.send(JSON.stringify(message));
      }
    }
  }

  getWorkspaceClients(workspaceId: string) {
    return Array.from(this.clients.values()).filter(
      (client) => client.workspaceId === workspaceId
    );
  }
}

export const websocketServer = new KlynWebSocketServer();
