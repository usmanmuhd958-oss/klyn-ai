export class SpatialBusError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.name = "SpatialBusError";
        this.code = code;
    }
}
//# sourceMappingURL=spatial-bus.types.js.map