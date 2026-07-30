export interface Observation {
    source: string;
    data: unknown;
    timestamp: number;
}


export class ObservationEngine {

    capture(
        source:string,
        data:unknown
    ):Observation {

        return {
            source,
            data,
            timestamp: Date.now()
        };
    }
}
