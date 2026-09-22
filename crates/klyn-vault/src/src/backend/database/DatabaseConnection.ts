export interface DatabaseConnectionConfig {
  provider:string;
  url?:string;
}

export class DatabaseConnection {

  private connected=false;

  connect(config:DatabaseConnectionConfig){
    this.connected=true;

    return {
      success:true,
      provider:config.provider
    };
  }

  status(){
    return {
      connected:this.connected
    };
  }
}
