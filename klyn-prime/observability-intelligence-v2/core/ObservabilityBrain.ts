/**
 * KLYN Prime Observability Intelligence v2
 *
 * Enterprise reliability intelligence foundation.
 */


export type SignalType =
    | "metric"
    | "event"
    | "trace";


export type HealthStatus =
    | "healthy"
    | "warning"
    | "critical";



export interface SystemSignal {

    id:string;

    component:string;

    type:SignalType;

    name:string;

    value:number;

    timestamp:number;

}



export interface Incident {

    id:string;

    component:string;

    description:string;

    severity:number;

    status:
        | "open"
        | "investigating"
        | "resolved";

}



export interface HealthReport {

    component:string;

    score:number;

    status:HealthStatus;

    recommendations:string[];

}







export class ObservabilityBrain {


    private signals:
        SystemSignal[];


    private incidents:
        Incident[];




    constructor(){

        this.signals=[];

        this.incidents=[];


        console.log(
            "[KLYN OBSERVABILITY INTELLIGENCE v2] Online"
        );

    }







    ingestSignal(
        signal:SystemSignal
    ){

        this.signals.push(
            signal
        );


        return signal;

    }







    detectAnomaly(
        component:string
    ){

        const data =
            this.signals.filter(

                item =>
                item.component === component

            );


        const abnormal =
            data.filter(

                item =>
                item.value > 90

            );



        return {

            component,

            anomalyDetected:
            abnormal.length > 0,


            count:
            abnormal.length

        };

    }







    createIncident(
        component:string,
        description:string,
        severity:number
    ){

        const incident:Incident = {


            id:
            crypto.randomUUID(),


            component,


            description,


            severity,


            status:
            "open"


        };


        this.incidents.push(
            incident
        );


        return incident;

    }







    generateHealthReport(
        component:string
    ):HealthReport{


        const issues =
            this.incidents.filter(

                item =>
                item.component === component

            );



        const score =
            Math.max(
                100 -
                issues.length * 20,
                0
            );



        return {

            component,


            score,


            status:
            score > 70
            ?
            "healthy"
            :
            score > 40
            ?
            "warning"
            :
            "critical",


            recommendations:
            issues.map(

                item =>
                "Investigate: " + item.description

            )

        };

    }







    snapshot(){

        return {

            signals:
            this.signals,


            incidents:
            this.incidents,


            timestamp:
            Date.now()

        };

    }



}
