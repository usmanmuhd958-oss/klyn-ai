import { RequestContext } from "./RequestContext.js";

export interface ApiMiddleware {
  execute(
    context: RequestContext,
    next: () => unknown
  ): unknown;
}
