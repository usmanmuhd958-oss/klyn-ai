export function streamToSSE(chunks, signal) {
    const encoder = new TextEncoder();
    return new ReadableStream({
        async start(controller) {
            try {
                for await (const chunk of chunks) {
                    if (signal?.aborted)
                        break;
                    controller.enqueue(encoder.encode(`event: token\ndata: ${JSON.stringify(chunk)}\n\n`));
                }
                if (!signal?.aborted)
                    controller.enqueue(encoder.encode("event: done\ndata: {}\n\n"));
                controller.close();
            }
            catch (error) {
                if (!signal?.aborted) {
                    controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({ error: error instanceof Error ? error.message : String(error) })}\n\n`));
                    controller.close();
                }
                else
                    controller.close();
            }
        },
        cancel() { },
    });
}
export function sseHeaders() {
    return new Headers({ "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache, no-transform", connection: "keep-alive" });
}
//# sourceMappingURL=sse.js.map