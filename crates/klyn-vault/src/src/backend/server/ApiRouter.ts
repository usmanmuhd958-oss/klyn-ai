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
