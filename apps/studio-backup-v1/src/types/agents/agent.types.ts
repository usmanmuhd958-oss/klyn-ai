export interface MarketplaceAgent {

id:string;

name:string;

category:
"coding"|
"testing"|
"deployment"|
"analysis";

capabilities:string[];

version:string;

status:
"installed"|
"available";

}
