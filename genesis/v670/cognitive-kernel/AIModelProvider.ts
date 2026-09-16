export interface AIModelProvider {
  name:string;
  execute(input:string):any;
}
