import './app.css'
import { CommandCopyError,copyCommandNumbers,parseNumbers } from './numbers.js'

type User={id:string;username:string;roles:string[]}
type Delivery={id:string;state:'pending'|'running'|'succeeded'|'failed';attempts:number;maxAttempts:number;availableAt:number;updatedAt:number;lastFailure:string|null}
type Command={id:string;createdAt:number|null;deliveryId:string|null;delivery:Delivery|null}
type Audit={id:string;deliveryId:string;actor:string;reason:string;createdAt:number;outcome:string;result:{state:string;attempts:number;maxAttempts:number}|null}
type Page<T>={nextCursor:string|null}&T
const root=document.querySelector<HTMLElement>('#main')!,notice=document.querySelector<HTMLElement>('#notice')!
const sidebar=document.querySelector<HTMLElement>('#sidebar')!,identity=document.querySelector<HTMLElement>('#identity')!,operatorNav=document.querySelector<HTMLElement>('#operator-nav')!
const themeButton=document.querySelector<HTMLButtonElement>('#theme')!,logout=document.querySelector<HTMLButtonElement>('#logout')!
let user:User|undefined,version=0,reads=new AbortController(),scope='mine',deliveryState='failed',noticeRoute=''
let clearPageSecrets=()=>{},accountPending=false,pendingKind:'password'|'sessions'|undefined
const reasons:Record<string,string>={'manual-retry':'Manual retry','provider-restored':'Provider restored','configuration-fixed':'Configuration fixed',investigating:'Investigating'}
const stateLabels:Record<string,string>={pending:'Pending',running:'Sending',succeeded:'Delivered',failed:'Failed',unknown:'Unavailable'}
function node<K extends keyof HTMLElementTagNameMap>(tag:K,text?:string,className?:string):HTMLElementTagNameMap[K]{const value=document.createElement(tag);if(text!==undefined)value.textContent=text;if(className)value.className=className;return value}
function group(...children:Node[]){const value=document.createDocumentFragment();value.append(...children);return value}
function link(label:string,href:string,className?:string){const value=node('a',label,className);value.href=href;return value}
function button(label:string,action:()=>void,className?:string){const value=node('button',label,className);value.type='button';value.addEventListener('click',action);return value}
function announce(message:string,error=false,route=location.hash){noticeRoute=route;notice.textContent=message;notice.dataset.error=String(error);notice.hidden=false}
function title(heading:string,subtitle:string,...actions:Node[]){const head=node('div',undefined,'page-head'),words=node('div');words.append(node('h1',heading),node('p',subtitle));head.append(words);if(actions.length){const tools=node('div',undefined,'actions');tools.append(...actions);head.append(tools)}return head}
function field(label:string,input:HTMLInputElement|HTMLTextAreaElement|HTMLSelectElement,hint?:string){const value=node('div'),id='field-'+crypto.randomUUID();input.id=id;const name=node('label',label);name.htmlFor=id;value.append(name,input);if(hint){const help=node('p',hint,'hint');help.id=id+'-hint';input.setAttribute('aria-describedby',help.id);value.append(help)}return value}
function select(options:Record<string,string>,value:string){const input=node('select');for(const[key,label]of Object.entries(options)){const option=node('option',label);option.value=key;input.append(option)}input.value=value;return input}
function cell(label:string,value:Node|string){const definition=node('dl',undefined,'cell'),term=node('dt',label),description=node('dd');description.append(typeof value==='string'?document.createTextNode(value):value);definition.append(term,description);return definition}
function details(values:Record<string,Node|string>){const result=node('dl',undefined,'details');for(const[label,value]of Object.entries(values)){const row=node('div'),dd=node('dd');dd.append(typeof value==='string'?document.createTextNode(value):value);row.append(node('dt',label),dd);result.append(row)}return result}
function status(value:string){const result=node('span',stateLabels[value]??value,'state');result.dataset.state=value;return result}
function time(value:number|null){return value===null?'Time unavailable':new Date(value).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'})}
function empty(heading:string,message:string,action?:Node){const value=node('section',undefined,'empty');value.append(node('h2',heading),node('p',message));if(action)value.append(action);return value}
function refresh(label='Refresh'){return button(label,()=>{void render()})}
function operator(){return user?.roles.includes('numbers-operator')??false}
class RequestError extends Error{constructor(readonly status:number,message:string,readonly data:unknown,readonly retryAfter?:number){super(message)}}
function viewerChanged(data:unknown):boolean{return !!data&&typeof data==='object'&&'code'in data&&data.code==='VIEWER_CHANGED'}
function sessionMessage(data:unknown):string{return viewerChanged(data)?'Your active account changed. Sign in or reload to continue.':'Your session ended. Sign in to continue.'}
async function api<T>(path:string,body?:unknown,options:{preserveUnauthorized?:boolean;acrossNavigation?:boolean;expectedStatus?:number}={}):Promise<T>{
  const controller=new AbortController(),parent=body===undefined&&!options.acrossNavigation?reads.signal:undefined;let expired=false
  const abort=()=>controller.abort();parent?.addEventListener('abort',abort,{once:true});if(parent?.aborted)abort()
  const timer=setTimeout(()=>{expired=true;controller.abort()},15000)
  try{
    const response=await fetch('/account'+path,{method:body===undefined?'GET':'POST',credentials:'same-origin',cache:'no-store',headers:{...(body===undefined?{}:{'Content-Type':'application/json'}),...(user?{'X-LongHorn-Viewer':user.id}:{})},signal:controller.signal,...(body===undefined?{}:{body:JSON.stringify(body)})})
    let data:unknown=null
    if(response.status!==204){try{data=await response.json()}catch(error){if(controller.signal.aborted)throw error;throw new RequestError(response.status,'The response could not be read. Try again.',null)}}
    if(!response.ok){
      if(response.status===401&&user&&!options.preserveUnauthorized){user=undefined;syncAccount();announce(sessionMessage(data),true,'#/login');location.hash='#/login';void render()}
      const message=data&&typeof data==='object'&&'error'in data&&typeof data.error==='string'?data.error.slice(0,200):'The request could not be completed.';const retry=response.headers.get('Retry-After');throw new RequestError(response.status,message,data,retry&&/^\d+$/.test(retry)&&Number(retry)<=86400?Number(retry):undefined)
    }
    if(options.expectedStatus&&response.status!==options.expectedStatus)throw new RequestError(0,'Unexpected response status',null)
    return data as T
  }catch(error){if(error instanceof RequestError)throw error;if(parent?.aborted)throw new DOMException('Navigation cancelled','AbortError');throw new RequestError(0,expired?'The request timed out. Try again.':'Could not reach LongHorn. Try again.',undefined)}
  finally{clearTimeout(timer);parent?.removeEventListener('abort',abort)}
}
function syncAccount(){logout.disabled=accountPending;for(const control of root.querySelectorAll<HTMLInputElement|HTMLButtonElement>('[data-account-control]'))control.disabled=accountPending;document.body.dataset.authenticated=String(!!user);sidebar.hidden=!user;logout.hidden=!user;operatorNav.hidden=!operator();identity.textContent=user?user.username+(operator()?' · Operator':' · Member'):''}
function welcome(){const value=node('section',undefined,'welcome');value.append(node('p','Command operations','eyebrow'),node('h1','Keep each command in view'),node('p','Create a command. Follow its delivery and receipt.'));const actions=node('div',undefined,'actions');actions.append(link('Sign in','#/login','button primary'),link('Create account','#/register','button'));value.append(actions,node('p','Your history stays with your account. Operators can inspect delivery failures and record recovery actions.','welcome-note'));return value}
function authPage(register:boolean){
  const value=node('section',undefined,'panel narrow');value.append(node('h1',register?'Create your account':'Sign in to LongHorn'),node('p',register?'Keep your commands and receipts together.':'Open your saved command history.','subtle'))
  const form=node('form',undefined,'form-stack'),username=node('input'),password=node('input'),error=node('p',undefined,'form-error'),submit=node('button',register?'Create account':'Sign in','primary')
  username.name='username';username.autocomplete='username';username.required=true;username.minLength=3;username.maxLength=64;username.spellcheck=false;username.autocapitalize='none'
  password.name='password';password.type='password';password.autocomplete=register?'new-password':'current-password';password.required=true;password.minLength=register?15:1;password.maxLength=256
  error.setAttribute('role','alert');error.hidden=true;submit.type='submit';submit.disabled=accountPending
  if(accountPending)value.append(node('p','An account change is still being checked. Wait before signing in.','subtle'))
  clearPageSecrets=()=>{password.value=''}
  form.append(field('Username',username,'3–64 letters, numbers, dots, dashes or underscores.'),field('Password',password,register?'Use at least 15 characters.':undefined),error,submit)
  form.addEventListener('submit',event=>{event.preventDefault();if(accountPending||submit.disabled)return;const current=version;submit.disabled=true;submit.textContent=register?'Creating account…':'Signing in…';error.hidden=true;void(async()=>{
    try{const input={username:username.value,password:password.value};if(register)await api('/register',input);const session=await api<{user:User}>('/login',input);password.value='';if(current!==version)return;user=session.user;syncAccount();location.hash='#/commands';announce(register?'Your account is ready.':'Signed in.')}
    catch(reason){if(current!==version)return;error.textContent=reason instanceof Error?reason.message:'Sign-in failed. Try again.';error.hidden=false;password.setAttribute('aria-invalid','true');password.focus()}
    finally{submit.disabled=false;submit.textContent=register?'Create account':'Sign in'}
  })()})
  const switcher=node('p',register?'Already have an account? ':'Need an account? ','form-switch');switcher.append(link(register?'Sign in':'Create account',register?'#/login':'#/register'));value.append(form,switcher);return value
}
function passwordSignIn(message:string,error=false){
  user=undefined;syncAccount();announce(message,error,'#/login');location.hash='#/login';void render()
}
function accountPage(){
  const value=node('div'),panels=node('div',undefined,'account-stack');value.append(title('Your account','Signed in as '+user!.username+'.'));panels.append(passwordPanel(),sessionPanel());value.append(panels);return value
}
function passwordPanel(){
  const panel=node('section',undefined,'panel account-panel');panel.append(node('h2','Change password'))
  if(document.body.dataset.passwordChanges!=='true'){
    panel.append(node('p','Password changes are unavailable on this host.','subtle'));return panel
  }
  panel.append(node('p','Changing it signs you out on every device.','subtle'))
  const form=node('form',undefined,'form-stack'),current=node('input'),next=node('input'),confirm=node('input')
  const error=node('p',undefined,'form-error'),submit=node('button','Change password','primary'),progress=node('p',undefined,'subtle')
  const username=node('input');username.type='hidden';username.name='username';username.autocomplete='username';username.value=user!.username
  for(const [input,name,autocomplete]of [[current,'currentPassword','current-password'],[next,'nextPassword','new-password'],[confirm,'confirmPassword','new-password']]as const){
    input.name=name;input.type='password';input.autocomplete=autocomplete;input.required=true;input.maxLength=256;input.dataset.accountControl='true'
    input.addEventListener('input',()=>{input.removeAttribute('aria-invalid');input.removeAttribute('aria-errormessage');error.hidden=true})
  }
  error.id='password-error';error.setAttribute('role','alert');error.hidden=true;submit.type='submit';submit.dataset.accountControl='true'
  progress.setAttribute('role','status');progress.hidden=!accountPending;progress.textContent=pendingKind==='sessions'?'Updating your sign-ins. Wait before making another account change.':'Checking a password change. Wait before signing in or submitting another.'
  const clear=()=>{current.value='';next.value='';confirm.value=''};clearPageSecrets=clear
  const pending=(active:boolean)=>{for(const input of [current,next,confirm])input.disabled=active;submit.disabled=active;submit.textContent=active&&pendingKind==='password'?'Changing password…':'Change password';progress.hidden=!active;form.setAttribute('aria-busy',String(active))}
  error.tabIndex=-1
  const invalid=(input:HTMLInputElement|undefined,message:string)=>{error.textContent=message;error.hidden=false;if(input){input.setAttribute('aria-invalid','true');input.setAttribute('aria-errormessage',error.id)}(input??error).focus()}
  pending(accountPending)
  form.append(username,field('Current password',current),field('New password',next,'Use 15–128 characters. Spaces count and are kept.'),field('Confirm new password',confirm),error,progress,submit)
  form.addEventListener('submit',event=>{
    event.preventDefault();if(accountPending||submit.disabled)return
    const length=[...next.value].length
    if(length<15||length>128){invalid(next,'Use 15–128 characters for your new password.');return}
    if(next.value!==confirm.value){invalid(confirm,'The new passwords do not match. Enter the same password twice.');return}
    const encoder=new TextEncoder(),left=encoder.encode(current.value),right=encoder.encode(next.value)
    if(left.length===right.length&&left.every((byte,index)=>byte===right[index])){invalid(next,'Choose a password different from your current one.');return}
    const currentVersion=version,subject=user!.id,input={currentPassword:current.value,nextPassword:next.value}
    error.hidden=true;for(const field of [current,next,confirm]){field.removeAttribute('aria-invalid');field.removeAttribute('aria-errormessage')}
    accountPending=true;pendingKind='password';pending(true);syncAccount()
    // fetch serializes immediately. Clear the controls while the native KDF runs.
    const request=api('/password',input,{preserveUnauthorized:true,expectedStatus:204});clear()
    void(async()=>{
      let finish:(()=>void)|undefined,message='',errorField:HTMLInputElement|undefined
      try{
        await request
        finish=()=>passwordSignIn('Password changed. Sign in with your new password. All your previous sessions have ended.')
      }catch(reason){
        if(reason instanceof RequestError&&reason.status===401&&viewerChanged(reason.data))finish=()=>passwordSignIn(sessionMessage(reason.data),true)
        else if(reason instanceof RequestError&&reason.status===401){
          // Reauthentication failure and session expiry share HTTP 401. Only a
          // successful, fresh session read allows this account to stay visible.
          try{
            const session=await api<{user:User}>('/session',undefined,{preserveUnauthorized:true,acrossNavigation:true})
            if(session.user.id!==subject)throw new Error('Account changed')
            user=session.user;errorField=current;message='Your current password was not correct. Enter your passwords again.'
          }catch{finish=()=>passwordSignIn('Your session could not be verified. Sign in to continue.',true)}
        }else if(reason instanceof RequestError&&reason.status===400){errorField=next;message='The password was not accepted. Use a different password with 15–128 characters.'}
        else if(reason instanceof RequestError&&reason.status===429){const minutes=reason.retryAfter===undefined?undefined:Math.max(1,Math.ceil(reason.retryAfter/60));message='Too many password attempts. '+(minutes===undefined?'Wait before trying again.':'Try again in '+minutes+' '+(minutes===1?'minute.':'minutes.'))}
        else if(reason instanceof RequestError&&reason.status===403)message='Password change was refused. Reload this page before trying again.'
        else finish=()=>passwordSignIn('Could not confirm the password change. Sign in with your new password. If it does not work, try your previous password.',true)
      }finally{
        clear();accountPending=false;pendingKind=undefined;syncAccount()
        if(finish)finish()
        else if(currentVersion===version){pending(false);invalid(errorField,message)}
        else{announce(message,true);if(location.hash==='#/account'||location.hash==='#/login'||location.hash==='#/register'||!user)void render()}
      }
    })()
  })
  panel.append(form);return panel
}
function sessionPanel(){
  const panel=node('section',undefined,'panel account-panel');panel.append(node('h2','Sign-in controls'))
  if(document.body.dataset.sessionControls!=='true'){
    panel.append(node('p','Session controls are unavailable on this host.','subtle'));return panel
  }
  panel.append(node('p','End other sign-ins, or sign out on every device.','subtle'),node('p','Ending other sessions keeps this browser signed in.','hint'))
  const actions=node('div',undefined,'actions'),progress=node('p',pendingKind==='sessions'?'Updating your sign-ins…':'An account change is still being checked.','hint');progress.setAttribute('role','status');progress.hidden=!accountPending
  for(const [scope,label]of [['others','End other sessions'],['all','Sign out everywhere']]as const){
    const control=button(label,()=>{
      if(accountPending)return
      const currentVersion=version;accountPending=true;pendingKind='sessions';clearPageSecrets();syncAccount();progress.hidden=false
      void(async()=>{
        let finish:(()=>void)|undefined,message='',failed=false
        try{
          const result=await api<{revokedSessions:number}>('/sessions/revoke',{scope},{expectedStatus:200})
          if(!result||!Number.isSafeInteger(result.revokedSessions)||result.revokedSessions<0||(scope==='all'&&result.revokedSessions===0))throw new Error('Invalid session control response')
          if(scope==='all')finish=()=>passwordSignIn('Signed out everywhere. Sign in to continue.')
          else message=result.revokedSessions===0?'No other active sessions to end.':'Ended '+result.revokedSessions+' other '+(result.revokedSessions===1?'session.':'sessions.')
        }catch(reason){
          failed=true
          if(reason instanceof RequestError&&reason.status===401)finish=()=>passwordSignIn(sessionMessage(reason.data),true)
          else if(reason instanceof RequestError&&(reason.status===400||reason.status===403))message='Session change was refused. Reload this page before trying again.'
          else finish=()=>passwordSignIn('Could not confirm the session change. Sign in to check your account.',true)
        }finally{
          accountPending=false;pendingKind=undefined;clearPageSecrets();syncAccount();progress.hidden=true
          if(finish)finish()
          else{announce(message,failed);if(currentVersion===version){notice.tabIndex=-1;notice.focus()}else if(location.hash==='#/account'||location.hash==='#/login'||location.hash==='#/register')void render()}
        }
      })()
    })
    control.dataset.accountControl='true';control.disabled=accountPending;actions.append(control)
  }
  panel.append(actions,progress);return panel
}
async function rerunPage(id:string){
  let data:{command:{id:string;numbers:unknown}}
  try{data=await api('/commands/'+id)}catch(reason){
    if(reason instanceof RequestError&&reason.status===404)return empty('Original command unavailable','This command could not be found or is not available to this account.',link('Your commands','#/commands','button'))
    throw reason
  }
  try{
    if(data?.command?.id!==id)throw new CommandCopyError()
    return newCommand({id,numbers:copyCommandNumbers(data.command.numbers)})
  }catch(reason){
    if(!(reason instanceof CommandCopyError))throw reason
    return empty('Cannot copy this command',reason.message,link('Create command','#/new','button'))
  }
}
function newCommand(source?:{id:string;numbers:number[]}){
  const value=node('div');value.append(title(source?'Run command again':'Create a command',source?'Review the numbers, then create a separate command.':'Compute a receipt from the numbers you enter.'))
  const panel=node('section',undefined,'panel'),form=node('form',undefined,'form-stack'),numbers=node('textarea'),error=node('p',undefined,'form-error'),submit=node('button','Create command','primary')
  let key=crypto.randomUUID(),lastInput=''
  if(source){const context=node('p','Copied from ','command-source');context.append(link('Command '+source.id.slice(0,8),'#/commands/'+source.id));panel.append(context);numbers.value=source.numbers.join(', ')}
  numbers.name='numbers';numbers.required=true;numbers.placeholder='For example: 4, 8, 15';numbers.setAttribute('inputmode','decimal');submit.type='submit';error.setAttribute('role','alert');error.hidden=true
  form.append(field('Numbers',numbers,'Separate up to 100 numbers with commas or spaces.'),error,submit)
  form.addEventListener('submit',event=>{event.preventDefault();let parsed:number[];try{parsed=parseNumbers(numbers.value)}catch(reason){error.textContent=(reason as Error).message;error.hidden=false;numbers.setAttribute('aria-invalid','true');numbers.focus();return}
    const canonical=JSON.stringify(parsed);if(lastInput&&canonical!==lastInput)key=crypto.randomUUID();lastInput=canonical
    error.hidden=true;numbers.removeAttribute('aria-invalid');numbers.disabled=true;submit.disabled=true;submit.textContent='Creating…';const current=version
    void api<{command:{id:string}}>('/commands',{id:key,numbers:parsed}).then(result=>{if(current!==version)return;announce('Command saved.',false,'#/commands/'+result.command.id);location.hash='#/commands/'+result.command.id}).catch(reason=>{if(current!==version)return;error.textContent=reason instanceof Error?reason.message:'Could not create the command.';error.hidden=false;submit.textContent='Try again'}).finally(()=>{submit.disabled=false;numbers.disabled=false;if(submit.textContent==='Creating…')submit.textContent='Create command'})
  });panel.append(form);value.append(panel);return value
}
function commandRow(command:Command){const row=node('li',undefined,'row'),name=node('div');name.append(link('Command '+command.id.slice(0,8),'#/commands/'+command.id),node('div',command.id,'row-id'));row.append(name,cell('Created',time(command.createdAt)),cell('Delivery',status(command.delivery?.state??'unknown')),cell('Attempts',command.delivery?command.delivery.attempts+' / '+command.delivery.maxAttempts:'—'));return row}
async function commandsPage(){
  const inputScope=operator()?scope:'mine',data=await api<Page<{commands:Command[]}>>('/commands?limit=20&scope='+inputScope),value=node('div');value.append(title(inputScope==='all'?'All commands':'Your commands','Follow each command through delivery and receipt.',refresh(),link('Create command','#/new','button primary')))
  if(operator()){const tools=node('div',undefined,'tools'),picker=select({mine:'My commands',all:'All commands'},inputScope);picker.addEventListener('change',()=>{scope=picker.value;void render()});tools.append(field('Show commands',picker));value.append(tools)}
  if(!data.commands.length){value.append(empty('No commands yet',inputScope==='all'?'Submitted commands will appear here.':'Create a command to start your history.',link('Create command','#/new','button primary')));return value}
  const rows=node('ul',undefined,'rows');rows.setAttribute('aria-label','Command history');rows.append(...data.commands.map(commandRow));value.append(rows)
  let cursor=data.nextCursor;const more=button('Load older commands',()=>{if(!cursor)return;more.disabled=true;const current=version;void api<Page<{commands:Command[]}>>('/commands?limit=20&scope='+inputScope+'&after='+encodeURIComponent(cursor)).then(next=>{if(current!==version)return;rows.append(...next.commands.map(commandRow));cursor=next.nextCursor;more.hidden=!cursor;announce('Loaded '+next.commands.length+' older commands.')}).catch(reason=>announce((reason as Error).message,true)).finally(()=>{more.disabled=false})},'more');more.hidden=!cursor;value.append(more);return value
}
function deliveryDetails(delivery:Delivery){return details({'Delivery ID':node('code',delivery.id),'Status':status(delivery.state),'Attempts':delivery.attempts+' of '+delivery.maxAttempts,'Updated':time(delivery.updatedAt),'Available':time(delivery.availableAt),'Last failure':delivery.lastFailure??'None'})}
async function commandPage(id:string){
  const data=await api<{command:{id:string;numbers:number[]};history:Command}>('/commands/'+id),value=node('div');value.append(link('Back to commands','#/commands','back'),title('Command '+id.slice(0,8),'Submitted '+time(data.history.createdAt),refresh('Refresh status'),link('Run again','#/new/'+id,'button')))
  const layout=node('div',undefined,'detail-grid'),input=node('section',undefined,'panel');input.append(node('h2','Your numbers'),node('p',data.command.numbers.join(', '),'numbers'),details({'Command ID':node('code',id)}));layout.append(input)
  const delivery=node('section',undefined,'panel');delivery.append(node('h2','Delivery'))
  if(data.history.delivery)delivery.append(deliveryDetails(data.history.delivery));else delivery.append(node('p',data.history.deliveryId?'Delivery metadata is no longer available.':'Delivery metadata could not be recovered.','subtle'))
  if(operator()&&data.history.deliveryId)delivery.append(link('Inspect delivery','#/deliveries/'+data.history.deliveryId,'back'));layout.append(delivery)
  const receipt=node('section',undefined,'panel wide');receipt.append(node('h2','Computed receipt'))
  try{const results=await api<{receipts:{messageId:string;result:{count:number;sum:number;min:number;max:number}}[]}>('/commands/'+id+'/receipt');for(const entry of results.receipts){const computed=node('dl',undefined,'receipt-values');for(const[label,amount]of Object.entries({Count:entry.result.count,Sum:entry.result.sum,Minimum:entry.result.min,Maximum:entry.result.max})){const pair=node('div');pair.append(node('dt',label),node('dd',String(amount)));computed.append(pair)}receipt.append(computed,details({'Message ID':node('code',entry.messageId)}))}}
  catch(reason){if(!(reason instanceof RequestError))throw reason;if(reason.status===401)throw reason;receipt.append(node('p',reason.status===404?'No receipt yet. Refresh status after delivery.':'The receipt service is unavailable. Refresh to try again.','subtle'))}
  layout.append(receipt);value.append(layout);return value
}
function deliveryRow(delivery:Delivery){const row=node('li',undefined,'row'),name=node('div');name.append(link('Delivery '+delivery.id.slice(0,8),'#/deliveries/'+delivery.id),node('div',delivery.id,'row-id'));row.append(name,cell('Updated',time(delivery.updatedAt)),cell('State',status(delivery.state)),cell('Attempts',delivery.attempts+' / '+delivery.maxAttempts));return row}
async function deliveriesPage(){
  const data=await api<Page<{deliveries:Delivery[]}>>('/operations/deliveries?state='+deliveryState+'&limit=20'),value=node('div');value.append(title('Outgoing deliveries','Inspect attempts and recover failed deliveries.',refresh()))
  const tools=node('div',undefined,'tools'),picker=select({failed:'Failed',pending:'Pending',running:'Sending',succeeded:'Delivered'},deliveryState);picker.addEventListener('change',()=>{deliveryState=picker.value;void render()});tools.append(field('Delivery state',picker));value.append(tools)
  const rows=node('ul',undefined,'rows');rows.setAttribute('aria-label','Outgoing deliveries');rows.append(...data.deliveries.map(deliveryRow));if(data.deliveries.length)value.append(rows);else value.append(empty('No '+(stateLabels[deliveryState]??deliveryState).toLowerCase()+' deliveries','Choose another state or refresh this list.'))
  let cursor=data.nextCursor;const more=button('Load older deliveries',()=>{if(!cursor)return;more.disabled=true;const current=version;void api<Page<{deliveries:Delivery[]}>>('/operations/deliveries?state='+deliveryState+'&limit=20&after='+encodeURIComponent(cursor)).then(next=>{if(current!==version)return;rows.append(...next.deliveries.map(deliveryRow));cursor=next.nextCursor;more.hidden=!cursor;announce('Loaded '+next.deliveries.length+' older deliveries.')}).catch(reason=>announce((reason as Error).message,true)).finally(()=>{more.disabled=false})},'more');more.hidden=!cursor;value.append(more);return value
}
async function deliveryPage(id:string){
  const {delivery}=await api<{delivery:Delivery}>('/operations/deliveries/'+id),value=node('div');value.append(link('Back to deliveries','#/deliveries','back'),title('Delivery '+id.slice(0,8),'Review the current attempt allowance before retrying.',refresh('Refresh status')))
  const layout=node('div',undefined,'detail-grid'),summary=node('section',undefined,'panel');summary.append(node('h2','Current state'),deliveryDetails(delivery),link('View recovery history','#/audit/'+id,'back'));layout.append(summary)
  const recovery=node('section',undefined,'panel');recovery.append(node('h2','Retry delivery'))
  if(delivery.state!=='failed')recovery.append(node('p','Only failed deliveries can be retried.','subtle'))
  else if(delivery.maxAttempts>=100)recovery.append(node('p','This delivery has reached its lifetime attempt limit.','subtle'))
  else{
    const form=node('form',undefined,'form-stack'),reason=select(reasons,'manual-retry'),additional=node('input'),error=node('p',undefined,'form-error'),submit=node('button','Retry delivery','primary')
    additional.type='number';additional.min='1';additional.max=String(100-delivery.maxAttempts);additional.step='1';additional.value='1';additional.required=true;submit.type='submit';error.setAttribute('role','alert');error.hidden=true
    form.append(field('Reason',reason),field('Additional attempts',additional,'Current allowance: '+delivery.maxAttempts+' lifetime attempts.'),error,submit)
    form.addEventListener('submit',event=>{event.preventDefault();submit.disabled=true;submit.textContent='Scheduling…';error.hidden=true;const current=version
      void api('/operations/deliveries/'+id+'/retry',{expectedMaxAttempts:delivery.maxAttempts,additionalAttempts:Number(additional.value),reason:reason.value}).then(()=>{if(current!==version)return;announce('Retry scheduled.');void render()}).catch(failure=>{if(current!==version)return;error.textContent=failure instanceof RequestError&&failure.status===409?'Delivery changed. Refresh status before retrying.':(failure as Error).message;error.hidden=false}).finally(()=>{submit.disabled=false;submit.textContent='Retry delivery'})
    });recovery.append(form)
  }
  layout.append(recovery);value.append(layout);return value
}
function auditRow(audit:Audit){const row=node('li',undefined,'row audit-row'),name=node('div');name.append(link('Delivery '+audit.deliveryId.slice(0,8),'#/deliveries/'+audit.deliveryId),node('div',time(audit.createdAt),'row-id'));row.append(name,cell('Actor',node('code',audit.actor)),cell('Reason',reasons[audit.reason]??audit.reason),cell('Outcome',audit.outcome.replace(/-/g,' ')));return row}
async function auditPage(id?:string){
  const query='?limit=20'+(id?'&deliveryId='+id:''),data=await api<Page<{records:Audit[]}>>('/operations/audit'+query),value=node('div');value.append(title('Recovery audit',id?'Recovery actions for delivery '+id.slice(0,8)+'.':'Who requested recovery, why, and what changed.',refresh()))
  if(id)value.append(link('Show all recovery actions','#/audit','back'))
  const rows=node('ul',undefined,'rows');rows.setAttribute('aria-label','Recovery audit');rows.append(...data.records.map(auditRow));if(data.records.length)value.append(rows);else value.append(empty('No recovery actions','Deliberate delivery retries will appear here.'))
  let cursor=data.nextCursor;const more=button('Load more actions',()=>{if(!cursor)return;more.disabled=true;const current=version;void api<Page<{records:Audit[]}>>('/operations/audit'+query+'&after='+encodeURIComponent(cursor)).then(next=>{if(current!==version)return;rows.append(...next.records.map(auditRow));cursor=next.nextCursor;more.hidden=!cursor;announce('Loaded '+next.records.length+' recovery actions.')}).catch(reason=>announce((reason as Error).message,true)).finally(()=>{more.disabled=false})},'more');more.hidden=!cursor;value.append(more);return value
}
async function render(){
  const current=++version;clearPageSecrets();clearPageSecrets=()=>{};reads.abort();reads=new AbortController();root.setAttribute('aria-busy','true');const [page='commands',id]=location.hash.replace(/^#\/?/,'').split('/')
  if(noticeRoute!==location.hash)notice.hidden=true
  for(const element of document.querySelectorAll<HTMLAnchorElement>('[data-nav]')){if(element.dataset.nav===page)element.setAttribute('aria-current','page');else element.removeAttribute('aria-current')}
  root.replaceChildren(title('Opening '+(page==='new'?'a command':page),'Reading the latest saved state.'))
  try{
    let content:Node
    if(id&&!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))content=empty('Invalid command link','Return to your command history.',link('Your commands','#/commands','button'))
    else if(!user)content=page==='register'?authPage(true):page==='login'?authPage(false):welcome()
    else if(page==='account')content=accountPage()
    else if(page==='new')content=id?await rerunPage(id):newCommand()
    else if(page==='commands'||page==='login'||page==='register')content=id?await commandPage(id):await commandsPage()
    else if((page==='deliveries'||page==='audit')&&!operator())content=empty('Operator access required','This account can create commands and read its own history.',link('Your commands','#/commands','button'))
    else if(page==='deliveries')content=id?await deliveryPage(id):await deliveriesPage()
    else if(page==='audit')content=await auditPage(id)
    else content=empty('Page not found','Return to your command history.',link('Your commands','#/commands','button'))
    if(current!==version)return;root.replaceChildren(content)
  }catch(error){
    if(current!==version||(error instanceof DOMException&&error.name==='AbortError'))return
    if(error instanceof RequestError&&error.status===401){user=undefined;syncAccount();root.replaceChildren(authPage(false));announce(sessionMessage(error.data),true)}
    else root.replaceChildren(empty(error instanceof RequestError&&error.status===403?'Access unavailable':'Could not open this page',error instanceof Error?error.message:'Refresh to try again.',refresh('Try again')))
  }finally{if(current===version){root.dataset.route=location.hash;root.setAttribute('aria-busy','false');root.focus({preventScroll:true});document.title=(user?'Command operations':'Sign in')+' · LongHorn'}}
}
function setTheme(dark:boolean,remember=false){document.documentElement.dataset.theme=dark?'dark':'light';themeButton.textContent=dark?'Light theme':'Dark theme';themeButton.setAttribute('aria-label',dark?'Use light theme':'Use dark theme');themeButton.setAttribute('aria-pressed',String(dark));if(remember){try{localStorage.setItem('longhorn-theme',dark?'dark':'light')}catch{}}}
let saved:string|null=null;try{saved=localStorage.getItem('longhorn-theme')}catch{}
setTheme(saved?saved==='dark':matchMedia('(prefers-color-scheme: dark)').matches)
themeButton.addEventListener('click',()=>setTheme(document.documentElement.dataset.theme!=='dark',true))
logout.addEventListener('click',()=>{if(accountPending||logout.disabled)return;logout.disabled=true;void api('/logout',{}).then(()=>{user=undefined;syncAccount();announce('Signed out.');location.hash='#/welcome';void render()}).catch(reason=>announce((reason as Error).message,true)).finally(()=>{logout.disabled=false})})
addEventListener('hashchange',()=>{void render()});addEventListener('pagehide',()=>{++version;reads.abort();clearPageSecrets();root.replaceChildren();sidebar.hidden=true;identity.textContent=''})
addEventListener('pageshow',event=>{if(event.persisted)location.reload()})
document.querySelector<HTMLAnchorElement>('.skip')!.addEventListener('click',event=>{event.preventDefault();root.focus()})
void api<{user:User}>('/session').then(session=>{user=session.user}).catch(error=>{if(!(error instanceof RequestError&&error.status===401))announce('Could not check your session. Sign in to try again.',true)}).finally(()=>{syncAccount();void render()})
