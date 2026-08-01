export class ExpertiseSelector {


    private experts:any[]=[];


    addExpert(name:string,domain:string){

        this.experts.push({
            name,
            domain
        });

    }


    find(domain:string){

        return this.experts.filter(
            e=>e.domain===domain
        );

    }

}
