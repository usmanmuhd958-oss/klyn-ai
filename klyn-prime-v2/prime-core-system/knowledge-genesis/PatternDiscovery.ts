export interface Pattern {

    name:string;

    category:string;

    confidence:number;

    discoveredAt:number;

}


export class PatternDiscovery {


    private patterns:Pattern[] = [];


    discover(
        data:any
    ){

        const pattern:Pattern = {

            name:"generated-pattern",

            category:"engineering",

            confidence:0.5,

            discoveredAt:
            Date.now()

        };


        this.patterns.push(pattern);


        return pattern;

    }


    getPatterns(){

        return this.patterns;

    }

}
