import * as Y from "yjs";
import type { WebsocketProvider } from "y-websocket";

export function attachSpaceDoc(room: string) {
  const doc = new Y.Doc();
  let provider: WebsocketProvider | null = null;
  const url = process.env.NEXT_PUBLIC_YJS_WS_URL;

  if (url && typeof window !== "undefined") {
    import("y-websocket")
      .then(({ WebsocketProvider: WS }) => {
        provider = new WS(url, room, doc, { connect: true });
      })
      .catch(() => {}); // silent degrade — local mode
  }

  return {
    doc,
    destroy: () => { provider?.destroy(); doc.destroy(); },
  };
}
