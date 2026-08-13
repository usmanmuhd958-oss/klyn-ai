export class InvoiceGenerator {

 generate(customer:string, amount:number){

  return {
   customer,
   amount,
   invoiceStatus:"CREATED"
  };

 }

}
