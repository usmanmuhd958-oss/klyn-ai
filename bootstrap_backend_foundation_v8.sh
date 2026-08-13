#!/data/data/com.termux/files/usr/bin/bash

set -e

echo "======================================"
echo " KLYN BACKEND FOUNDATION V8"
echo " API CONTRACT + REQUEST PIPELINE LAYER"
echo "======================================"

BASE="src/backend/server"

mkdir -p "$BASE"

cat > "$BASE/RequestContext.ts" <<'TS'
export interface RequestContext {
  requestId: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
}
TS


cat > "$BASE/ResponseFormatter.ts" <<'TS'
export class ResponseFormatter {

  success(data: unknown) {
    return {
      success: true,
      data,
      timestamp: Date.now()
    };
  }


  error(message: string) {
    return {
      success: false,
      error: message,
      timestamp: Date.now()
    };
  }

}
TS


cat > "$BASE/ErrorBoundary.ts" <<'TS'
export class ErrorBoundary {

  handle(error: unknown) {

    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : String(error),
      timestamp: Date.now()
    };

  }

}
TS


cat > "$BASE/ApiMiddleware.ts" <<'TS'
import { RequestContext } from "./RequestContext.js";

export interface ApiMiddleware {
  execute(
    context: RequestContext,
    next: () => unknown
  ): unknown;
}
TS


cat > "$BASE/ApiRouter.ts" <<'TS'
import { ResponseFormatter } from "./ResponseFormatter.js";

export class ApiRouter {

  private formatter = new ResponseFormatter();

  routes = new Map<string, Function>();


  register(
    path: string,
    handler: Function
  ) {
    this.routes.set(path, handler);
  }


  handle(path: string, payload: unknown) {

    const handler = this.routes.get(path);

    if (!handler) {
      return this.formatter.error(
        "Route not found"
      );
    }


    return this.formatter.success(
      handler(payload)
    );

  }

}
TS


echo ""
echo "✓ ApiRouter.ts created"
echo "✓ RequestContext.ts created"
echo "✓ ResponseFormatter.ts created"
echo "✓ ErrorBoundary.ts created"
echo "✓ ApiMiddleware.ts created"

echo ""
echo "======================================"
echo " BACKEND FOUNDATION V8 READY"
echo " API CONTRACT LAYER ONLINE"
echo "======================================"

