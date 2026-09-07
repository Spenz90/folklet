import {spawn} from 'node:child_process';
import readline from 'node:readline';

const AUTH_HOSTS=new Set(['auth.openai.com','chatgpt.com']);
const ACCOUNT_TYPES=new Set(['chatgpt','apiKey','chatgptAuthTokens','amazonBedrock','agentIdentity','personalAccessToken']);
const PLAN_TYPES=new Set(['free','go','plus','pro','prolite','team','self_serve_business_prolite','self_serve_business_usage_based','business','ent26','enterprise_cbp_automation','enterprise_cbp_usage_based','enterprise','edu','edu_plus','edu_pro','unknown']);
const ACTIVE_LOGIN=new Set(['starting','pending','canceling']);
const accountError=(message,code='ACCOUNT_ERROR')=>Object.assign(new Error(message),{code});
const safePlan=value=>PLAN_TYPES.has(value)?value:null;
const validLoginId=value=>typeof value==='string'&&/^[a-z\d_-]{1,160}$/i.test(value);
function loginURL(value){
  if(typeof value!=='string'||value.length>16000||/[\s\\\u0000-\u001f\u007f]/.test(value))throw accountError('Codex returned an invalid ChatGPT sign-in address.','INVALID_LOGIN_URL');
  let url;try{url=new URL(value);}catch{throw accountError('Codex returned an invalid ChatGPT sign-in address.','INVALID_LOGIN_URL');}
  if(url.protocol!=='https:'||!AUTH_HOSTS.has(url.hostname)||url.port||url.username||url.password)throw accountError('Codex returned an unsupported ChatGPT sign-in address.','INVALID_LOGIN_URL');
  return url.href;
}

/** A narrow broker for Codex-managed account sign-in over app-server stdio.
 * Codex owns credential persistence and refresh. This class never reads auth
 * files, accepts tokens, logs protocol traffic, or signs out a shared account.
 */
export class AccountConnection {
  constructor({executable,spawnProcess=spawn,cwd,env=process.env,requestTimeoutMs=15000,loginTimeoutMs=600000,onChange=()=>{},now=Date.now}={}){
    if(typeof executable!=='string'||!executable.trim())throw accountError('FOLKLET could not find its Codex runtime.','RUNTIME_MISSING');
    this.executable=executable;this.spawnProcess=spawnProcess;this.cwd=cwd;this.env=env;
    this.requestTimeoutMs=Math.max(1,Number(requestTimeoutMs)||15000);
    this.loginTimeoutMs=Math.max(1,Number(loginTimeoutMs)||600000);
    this.onChange=onChange;this.now=now;this.connection=null;this.closed=false;
    this.statusPromise=null;this.beginPromise=null;this.cancelPromise=null;this.login=null;
    this.account={connected:false,type:null,plan:null,requiresOpenaiAuth:true};this.accountRevision=0;this.lastError=null;
  }

  snapshot(){
    const login=this.login?{loginId:this.login.loginId,status:this.login.status,expiresAt:this.login.expiresAt,error:this.login.error}:null;
    return {...this.account,login,error:this.lastError};
  }

  changed(){try{this.onChange(this.snapshot());}catch{/* Observers cannot disrupt account operations. */}}

  connect(){
    if(this.closed)return Promise.reject(accountError('The account connection is closed.','CLOSED'));
    if(this.connection)return this.connection.ready;
    const connection={process:null,pending:new Map(),seq:0,closed:false,reader:null};
    this.connection=connection;
    connection.ready=Promise.resolve().then(async()=>{
      if(this.closed||connection.closed)throw accountError('The account connection is closed.','CLOSED');
      let proc;
      try{proc=this.spawnProcess(this.executable,['app-server'],{cwd:this.cwd,env:this.env,windowsHide:true,stdio:['pipe','pipe','pipe']});}
      catch{throw accountError('FOLKLET could not start its Codex runtime. Check that setup has finished.','RUNTIME_START_FAILED');}
      connection.process=proc;
      proc.on('error',()=>this.disconnect(connection,accountError('FOLKLET could not start its Codex runtime. Check that setup has finished.','RUNTIME_START_FAILED')));
      proc.on('close',()=>this.disconnect(connection,accountError('The Codex account connection stopped. Try again.','DISCONNECTED')));
      proc.on('exit',()=>this.disconnect(connection,accountError('The Codex account connection stopped. Try again.','DISCONNECTED')));
      proc.stderr.on('data',()=>{});
      proc.stdin.on('error',()=>this.disconnect(connection,accountError('The Codex account connection stopped. Try again.','DISCONNECTED')));
      connection.reader=readline.createInterface({input:proc.stdout});
      connection.reader.on('line',line=>this.receive(connection,line));
      await this.rpc(connection,'initialize',{clientInfo:{name:'crew_account',title:'FOLKLET',version:'0.6.1'},capabilities:{}});
      this.write(connection,{method:'initialized',params:{}});
      return connection;
    }).catch(error=>{
      const safe=error?.code?error:accountError('FOLKLET could not initialize its Codex account connection.','INITIALIZE_FAILED');
      this.disconnect(connection,safe);throw safe;
    });
    return connection.ready;
  }

  write(connection,message){
    if(connection.closed||!connection.process||connection.process.killed)throw accountError('The Codex account connection stopped. Try again.','DISCONNECTED');
    try{connection.process.stdin.write(JSON.stringify(message)+'\n');}
    catch{this.disconnect(connection,accountError('The Codex account connection stopped. Try again.','DISCONNECTED'));throw accountError('The Codex account connection stopped. Try again.','DISCONNECTED');}
  }

  rpc(connection,method,params={}){
    return new Promise((resolve,reject)=>{
      const id=++connection.seq;
      const timer=setTimeout(()=>this.disconnect(connection,accountError('The Codex account request timed out. Try again.','TIMEOUT')),this.requestTimeoutMs);
      connection.pending.set(id,{resolve,reject,timer,method});
      try{this.write(connection,{id,method,params});}
      catch(error){clearTimeout(timer);connection.pending.delete(id);reject(error);}
    });
  }

  receive(connection,line){
    if(connection.closed||line.length>1000000)return;
    let message;try{message=JSON.parse(line);}catch{return;}
    if(!message||typeof message!=='object')return;
    if(message.id!==undefined&&!message.method){
      const pending=connection.pending.get(message.id);if(!pending)return;
      clearTimeout(pending.timer);connection.pending.delete(message.id);
      // Upstream errors can contain auth URLs or tokens: never forward them.
      if(message.error)pending.reject(accountError('Codex could not complete the account request. Try again.','RPC_ERROR'));
      else pending.resolve(message.result);
      return;
    }
    if(message.id!==undefined){
      try{this.write(connection,{id:message.id,error:{code:-32601,message:'FOLKLET supports Codex-managed ChatGPT sign-in only.'}});}catch{}
      return;
    }
    const params=message.params||{};
    if(message.method==='account/updated'){
      const modes={apikey:'apiKey',chatgpt:'chatgpt',chatgptAuthTokens:'chatgptAuthTokens',agentIdentity:'agentIdentity',personalAccessToken:'personalAccessToken',bedrockApiKey:'amazonBedrock',bedrockAccessKeys:'amazonBedrock'};
      const type=modes[params.authMode]||null;
      this.account={...this.account,connected:!!type,type,plan:safePlan(params.planType)};
      this.accountRevision++;
      this.lastError=null;this.changed();
    }else if(message.method==='account/login/completed'){
      const attempt=this.login;
      if(!attempt||!validLoginId(params.loginId)||!ACTIVE_LOGIN.has(attempt.status))return;
      if(attempt.status==='starting'){attempt.earlyCompletion={loginId:params.loginId,success:params.success===true};return;}
      if(params.loginId===attempt.loginId)this.complete(attempt,params.success===true);
    }
  }

  complete(attempt,success){
    if(this.login!==attempt||!ACTIVE_LOGIN.has(attempt.status))return;
    clearTimeout(attempt.timer);attempt.authUrl=null;
    attempt.status=success?'completed':attempt.cancelRequested?'cancelled':'failed';
    attempt.error=success||attempt.cancelRequested?null:'ChatGPT sign-in did not finish. Try again.';
    if(success){this.account={...this.account,connected:true,type:'chatgpt'};this.accountRevision++;}
    this.changed();
  }

  disconnect(connection,error){
    if(connection.closed)return;
    connection.closed=true;connection.reader?.close();
    for(const pending of connection.pending.values()){clearTimeout(pending.timer);pending.reject(error);}
    connection.pending.clear();
    try{if(connection.process&&!connection.process.killed)connection.process.kill();}catch{}
    if(this.connection===connection){
      this.connection=null;this.lastError=error.message;
      this.account={connected:false,type:null,plan:null,requiresOpenaiAuth:true};
      this.accountRevision++;
      if(this.login&&ACTIVE_LOGIN.has(this.login.status)){
        clearTimeout(this.login.timer);this.login.authUrl=null;this.login.status='failed';this.login.error=error.message;
      }
      this.changed();
    }
  }

  async status(){
    if(this.statusPromise)return this.statusPromise;
    const work=(async()=>{
      try{
        const connection=await this.connect(),revision=this.accountRevision;
        const result=await this.rpc(connection,'account/read',{refreshToken:false});
        const type=ACCOUNT_TYPES.has(result?.account?.type)?result.account.type:null;
        // A notification delivered alongside the response can be newer than it.
        if(revision===this.accountRevision)this.account={connected:!!type,type,plan:safePlan(result?.account?.planType),requiresOpenaiAuth:result?.requiresOpenaiAuth!==false};
        this.lastError=null;
      }catch(error){this.lastError=error?.code?error.message:'FOLKLET could not read the Codex account. Try again.';}
      return this.snapshot();
    })();
    this.statusPromise=work;
    try{return await work;}finally{if(this.statusPromise===work)this.statusPromise=null;}
  }

  async beginLogin(){
    if(this.cancelPromise)await this.cancelPromise;
    if(this.beginPromise)return this.beginPromise;
    if(this.login?.status==='pending')return {loginId:this.login.loginId,authUrl:this.login.authUrl};
    const work=(async()=>{
      const connection=await this.connect();
      const attempt={loginId:null,authUrl:null,status:'starting',expiresAt:null,error:null};
      this.login=attempt;this.lastError=null;this.changed();
      try{
        const result=await this.rpc(connection,'account/login/start',{type:'chatgpt'});
        if(result?.type!=='chatgpt'||!validLoginId(result.loginId))throw accountError('Codex returned an invalid ChatGPT sign-in response.','INVALID_LOGIN_RESPONSE');
        attempt.loginId=result.loginId;
        try{attempt.authUrl=loginURL(result.authUrl);}
        catch(error){
          // Release the pending localhost callback even when its URL is rejected.
          try{await this.rpc(connection,'account/login/cancel',{loginId:attempt.loginId});}catch{this.disconnect(connection,error);}
          throw error;
        }
        attempt.status='pending';attempt.expiresAt=this.now()+this.loginTimeoutMs;
        const response={loginId:attempt.loginId,authUrl:attempt.authUrl};
        if(attempt.earlyCompletion?.loginId===attempt.loginId)this.complete(attempt,attempt.earlyCompletion.success);
        else{
          attempt.timer=setTimeout(()=>this.expire(attempt),this.loginTimeoutMs);
          attempt.timer.unref?.();
        }
        delete attempt.earlyCompletion;this.changed();return response;
      }catch(error){
        clearTimeout(attempt.timer);attempt.authUrl=null;attempt.status='failed';
        attempt.error=error?.code?error.message:'ChatGPT sign-in could not start. Try again.';this.lastError=attempt.error;
        // A malformed response leaves no trustworthy login ID to cancel.
        if(!attempt.loginId)this.disconnect(connection,accountError(attempt.error,error?.code||'LOGIN_FAILED'));
        this.changed();throw accountError(attempt.error,error?.code||'LOGIN_FAILED');
      }
    })();
    this.beginPromise=work;
    try{return await work;}finally{if(this.beginPromise===work)this.beginPromise=null;}
  }

  expire(attempt){
    if(this.cancelPromise)return;
    const work=this.cancelAttempt(attempt,'expired');this.cancelPromise=work;
    work.catch(()=>{}).then(()=>{if(this.cancelPromise===work)this.cancelPromise=null;});
  }

  async cancelAttempt(attempt,reason='cancelled'){
    if(this.login!==attempt||!ACTIVE_LOGIN.has(attempt.status))return {status:'notFound',loginId:attempt.loginId};
    clearTimeout(attempt.timer);attempt.authUrl=null;attempt.cancelRequested=true;
    attempt.status=reason==='expired'?'expired':'canceling';
    attempt.error=reason==='expired'?'ChatGPT sign-in expired. Start again.':null;this.changed();
    const connection=this.connection;
    if(!connection||connection.closed)return {status:'notFound',loginId:attempt.loginId};
    try{
      const result=await this.rpc(connection,'account/login/cancel',{loginId:attempt.loginId});
      if(this.login===attempt&&attempt.status!=='completed')attempt.status=reason;
      this.changed();return {status:result?.status==='notFound'?'notFound':'canceled',loginId:attempt.loginId};
    }catch(error){
      // Closing only this broker stops an orphan callback; it never logs out.
      this.disconnect(connection,error);throw error;
    }
  }

  async cancel(loginId){
    if(this.cancelPromise)return this.cancelPromise;
    const work=(async()=>{
      if(this.beginPromise){try{await this.beginPromise;}catch{return {status:'notFound',loginId:validLoginId(loginId)?loginId:null};}}
      const attempt=this.login;
      if(!attempt||!ACTIVE_LOGIN.has(attempt.status)||(loginId!==undefined&&loginId!==attempt.loginId))return {status:'notFound',loginId:validLoginId(loginId)?loginId:null};
      return this.cancelAttempt(attempt);
    })();
    this.cancelPromise=work;
    try{return await work;}finally{if(this.cancelPromise===work)this.cancelPromise=null;}
  }

  close(){
    this.closed=true;
    if(this.login)clearTimeout(this.login.timer);
    if(this.connection)this.disconnect(this.connection,accountError('The account connection is closed.','CLOSED'));
  }
}
