import {DEFAULT_PROFILE,NATIVE_PROFILE,FlowError,validateRule,validateProfile,nextPlan,dateFor,localDay,formatDate,keyFor,safeUrl,redact,textMatchesRow} from './core.js';
const DB='hkustExtensionV1';
let queue=Promise.resolve();
const serial=fn=>{const r=queue.then(fn);queue=r.catch(()=>{});return r;};
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function state(){const s=(await chrome.storage.local.get(DB))[DB]||{rules:[],profile:structuredClone(NATIVE_PROFILE),runs:[],ledger:{},catalog:null,recordingTab:null,plans:{}};const mode=s.preferences?.mode||s.rules.at(-1)?.mode;s.preferences={...s.preferences,mode:['dry_run','prepare','auto'].includes(mode)?mode:'dry_run'};return s;}
const isNative=p=>p.version==='hkust_drupal_v1';
const confirmationOf=(profile,row)=>isNative(profile)?row.confirmationNumber||row.confirmationInfo:row;
async function auth(tabId,profile){
  if(!isNative(profile))return page(tabId,{type:'STATUS',authenticated:profile.authenticated});
  const result=await page(tabId,{type:'NATIVE_AUTH',accountHash:profile.accountHash});
  if(!profile.accountHash)profile.accountHash=result.accountHash;
  return {authenticated:true};
}
async function save(s){await chrome.storage.local.set({[DB]:s});}
async function notice(title,message){await chrome.notifications.create({type:'basic',iconUrl:'icons/icon128.png',title,message:redact(message)}).catch(()=>{});}
async function log(s,data){const run={id:crypto.randomUUID(),createdAt:new Date().toISOString(),...data};s.runs.unshift(run);s.runs=s.runs.slice(0,300);await save(s);return run;}
async function page(tabId,message){
  try {const response=await chrome.tabs.sendMessage(tabId,message);if(!response?.ok)throw new FlowError(response?.code||'PAGE_CHANGED',response?.error||'页面适配器无响应');return response.result;}
  catch(e){if(e instanceof FlowError)throw e;throw new FlowError('PAGE_CHANGED','无法连接页面。请等待加载或刷新官方页面后重试');}
}
async function ready(tabId){
  for(let i=0;i<40;i++){
    const tab=await chrome.tabs.get(tabId).catch(()=>null);
    if(!tab)throw new FlowError('CANCELLED','预订标签页已被关闭');
    if(tab.url==='about:blank'||tab.pendingUrl){await delay(350);continue;}
    if(tab.status==='complete'){
      if(!safeUrl(tab.url))throw new FlowError('AUTH_REQUIRED','已转到 CAS/认证页面，请在浏览器中手动完成登录');
      try{await page(tabId,{type:'PING'});return;}catch(e){if(i===39)throw e;}
    }
    await delay(350);
  }
  throw new FlowError('NETWORK_ERROR','页面加载超时，尚未确认结果');
}
async function openOfficial(url,active=false){
  if(!safeUrl(url))throw new FlowError('CONFIG_REQUIRED','只允许 HKUST FBS 官方预订地址');
  const tab=await chrome.tabs.create({url:'about:blank',active});
  await delay(120);await chrome.tabs.update(tab.id,{url});await ready(tab.id);return tab.id;
}
async function targetTab(s,create=false){
  if(s.recordingTab){const t=await chrome.tabs.get(s.recordingTab).catch(()=>null);if(t&&safeUrl(t.url))return t.id;}
  const tabs=await chrome.tabs.query({url:['https://fbs.hkust.edu.hk/*','https://w5.ab.ust.hk/fbs_user/*']});
  if(tabs.length){const t=tabs.find(t=>t.active)||tabs[0];return t.id;}
  if(create)return openOfficial(s.profile.entryUrl,true);
  throw new FlowError('CONFIG_REQUIRED','先打开并登录官方预订页面');
}
async function reschedule(s){
  const existing=await chrome.alarms.getAll();
  for(const a of existing)if(a.name.startsWith('hkust:'))await chrome.alarms.clear(a.name);
  s.plans={};
  for(const rule of s.rules.filter(r=>r.enabled)){
    const plan=nextPlan(rule);if(!plan)continue;s.plans[rule.id]=plan;
    await chrome.alarms.create(`hkust:pre:${rule.id}`,{when:Math.max(Date.now()+1000,plan.precheckAt)});
    await chrome.alarms.create(`hkust:run:${rule.id}`,{when:plan.submitAt});
  }
  await save(s);
}
async function cancelled(ruleId){if((await chrome.storage.local.get(`cancel:${ruleId}`))[`cancel:${ruleId}`])throw new FlowError('CANCELLED','任务已被你取消');}
async function stepFlow(tabId,steps,vars,auth,ruleId,allowSubmit=false,stageHook=null){
  for(const [index,step] of steps.entries()){
    await cancelled(ruleId);
    if(step.phase!=='prepare'&&!allowSubmit)continue;
    if(step.phase==='submit'||step.phase==='confirm'){
      await page(tabId,{type:'REVIEW',vars,authenticated:auth});
      if(stageHook)await stageHook(step,index);
    }
    await page(tabId,{type:'STEP',step,vars,authenticated:auth});
    await delay(650);await ready(tabId);
  }
}
async function records(profile,vars,rule){
  const tabId=await openOfficial(profile.records.url);
  try{
    await auth(tabId,profile);
    if(isNative(profile))return await page(tabId,{type:'NATIVE_RECORDS',vars});
    await stepFlow(tabId,profile.records.steps.map(step=>({...step,readOnly:true})),vars,profile.authenticated,rule.id);
    const rows=await page(tabId,{type:'ROWS',locator:profile.records.rows});
    return rows.filter(row=>textMatchesRow(row,rule,vars.targetDate,vars.slot,profile.dateFormat));
  }finally{await chrome.tabs.remove(tabId).catch(()=>{});}
}
async function precheck(ruleId){
  const s=await state(),rule=s.rules.find(r=>r.id===ruleId);if(!rule?.enabled)return;
  const plan=s.plans[ruleId];if(!plan)return;
  try{
    validateProfile(s.profile,false);
    const tabId=await openOfficial(s.profile.entryUrl);
    await auth(tabId,s.profile);
    s.prepared={...s.prepared,[ruleId]:tabId};
    await log(s,{ruleId,facilityName:rule.facilityName,targetDate:plan.targetDate,status:'PRECHECK_OK',stage:'precheck',message:'登录态有效；将在开放时间执行。浏览器须保持运行、电脑须保持唤醒。'});
  }catch(e){await log(s,{ruleId,status:e.code||'PAGE_CHANGED',stage:'precheck',targetDate:plan.targetDate,message:redact(e.message)});await notice('HKUST 晚间/开放前检查需要处理',e.message);}
}
async function execute(ruleId,{scheduled=false,forceDry=false}={}){
  const s=await state(),rule=s.rules.find(r=>r.id===ruleId);
  if(!rule)throw new FlowError('CONFIG_REQUIRED','规则不存在');
  if(scheduled&&!rule.enabled)return;
  const mode=forceDry?'dry_run':rule.mode,profile=s.profile;
  validateRule(rule);validateProfile(profile,mode==='auto');
  if((rule.userType==='family_card')!==(new URL(profile.entryUrl).hostname==='w5.ab.ust.hk'))throw new FlowError('CONFIG_REQUIRED','用户类型与已录制入口不一致；请先为所选用户类型录制对应官方页面');
  const plan=scheduled?s.plans[ruleId]:null;
  if(scheduled&&(!plan||Date.now()-plan.submitAt>rule.maxLateSeconds*1000)){
    await log(s,{ruleId,status:'MANUAL_ACTION_REQUIRED',stage:'schedule',message:'浏览器唤醒过晚，超过允许延迟；本次未提交，请人工检查'});return;
  }
  const targetDate=plan?.targetDate||dateFor(rule,localDay(Date.now(),rule.timezone));
  if(!targetDate){await log(s,{ruleId,status:'SKIPPED',stage:'date',message:'今天不符合重复规则'});return;}
  await chrome.storage.local.remove(`cancel:${ruleId}`);
  const run=await log(s,{ruleId,status:'RUNNING',stage:'prepare',startedAt:new Date().toISOString(),facilityId:rule.facilityId,facilityName:rule.facilityName,targetDate,mode,timezone:rule.timezone,slots:[],message:'开始执行'});
  let tabId=null;const primary=new Set(rule.slots.map(x=>x.id));
  const candidates=[...rule.slots,...rule.fallbackSlots];let successes=0,primarySuccess=false;
  try{
    // Bind the first authenticated account before deriving duplicate-prevention keys.
    // A dry-run is optional; authentication and final booking review still run.
    if(isNative(profile)&&!profile.accountHash){
      const authTab=await openOfficial(profile.entryUrl);
      try{await auth(authTab,profile);await save(s);}finally{await chrome.tabs.remove(authTab).catch(()=>{});}
    }
    for(const slot of candidates){
      await cancelled(ruleId);
      if(!primary.has(slot.id)&&primarySuccess)break;
      const vars={facilityId:rule.facilityId,facilityName:rule.facilityName,categoryId:rule.categoryId,location:rule.location,targetDate,formattedDate:formatDate(targetDate,profile.dateFormat),slot};
      const key=keyFor(profile.accountHash||profile.identity,rule,targetDate,slot);
      if(mode==='auto'&&s.ledger[key]){
        const entry=s.ledger[key];
        if(entry.status==='SUCCEEDED'||entry.status==='DUPLICATE'){
          run.slots.push({slot:slot.label,status:'DUPLICATE',message:'本地已确认此预订'});successes++;if(primary.has(slot.id))primarySuccess=true;
          if(rule.attemptMode==='first_success')break;continue;
        }
        if(['SUBMITTING','UNKNOWN','CANCELLED'].includes(entry.status))throw new FlowError('MANUAL_ACTION_REQUIRED','相同预订存在未核实提交，本次不会重提；请在官方记录页核实后手动解除');
      }
      if(mode==='auto'){
        const found=await records(profile,vars,rule);
        if(found.length){s.ledger[key]={status:'DUPLICATE',at:new Date().toISOString(),confirmation:confirmationOf(profile,found[0])};await save(s);run.slots.push({slot:slot.label,status:'DUPLICATE'});successes++;if(primary.has(slot.id))primarySuccess=true;if(rule.attemptMode==='first_success')break;continue;}
      }else if(isNative(profile)){
        const found=await records(profile,vars,rule);run.recordsChecked=true;run.existingBooking=found.length>0;await save(s);
      }
      try{
        const existing=s.prepared?.[ruleId];
        if(existing&&await chrome.tabs.get(existing).catch(()=>null)){
          tabId=existing;delete s.prepared[ruleId];await chrome.tabs.update(tabId,{url:profile.entryUrl,active:!scheduled});await ready(tabId);
        }else tabId=await openOfficial(profile.entryUrl,!scheduled);
        await auth(tabId,profile);
        run.stage='select';await save(s);
        let crossed=false;
        const markSubmitting=async()=>{
          // Write-ahead marker: a browser/worker crash from here never permits an automatic repeat.
          crossed=true;s.ledger[key]={status:'SUBMITTING',runId:run.id,at:new Date().toISOString()};run.stage='submit';await save(s);
        };
        let nativeDetails=null;
        if(isNative(profile)){
          nativeDetails=(await page(tabId,{type:'NATIVE_PREPARE',vars})).details;
          await cancelled(ruleId);
          if(mode==='auto'){
            await page(tabId,{type:'NATIVE_REVIEW',vars});
            await markSubmitting();await cancelled(ruleId);await page(tabId,{type:'NATIVE_SUBMIT',vars});
          }
        }else await stepFlow(tabId,profile.steps,vars,profile.authenticated,ruleId,mode==='auto',markSubmitting);
        if(mode!=='auto'){
          if(!isNative(profile))await page(tabId,{type:'REVIEW',vars,authenticated:profile.authenticated});
          run.slots.push({slot:slot.label,status:mode==='dry_run'?'DRY_RUN_OK':'PREPARED',details:nativeDetails,message:'设施、完整日期和时段已核对，未提交'});
          if(rule.attemptMode==='first_success')break;
          if(mode==='prepare')break;
          continue;
        }
        run.stage='reconcile';await save(s);
        const result=isNative(profile)?null:await page(tabId,{type:'RESULT',success:profile.success,confirmationNumber:profile.confirmationNumber});
        const found=await records(profile,vars,rule);
        if(!crossed||!found.length||!isNative(profile)&&(!result.success||!result.confirmationNumber))throw new FlowError('RESULT_UNKNOWN','提交后未取得明确的官方预订记录；禁止自动重提');
        const confirmation=isNative(profile)?found[0].confirmationNumber||found[0].confirmationInfo:result.confirmationNumber;
        s.ledger[key]={status:'SUCCEEDED',at:new Date().toISOString(),confirmation};await save(s);
        run.slots.push({slot:slot.label,status:'SUCCEEDED',confirmation,submittedAt:new Date().toISOString()});successes++;if(primary.has(slot.id))primarySuccess=true;
        if(rule.attemptMode==='first_success')break;
      }catch(e){
        if(s.ledger[key]?.status==='SUBMITTING'){
          // Navigation or connection loss after submit: query records before deciding anything.
          try{const found=await records(profile,vars,rule);if(found.length){const confirmation=confirmationOf(profile,found[0]);s.ledger[key]={status:'SUCCEEDED',at:new Date().toISOString(),confirmation};run.slots.push({slot:slot.label,status:'SUCCEEDED',confirmation});successes++;if(primary.has(slot.id))primarySuccess=true;await save(s);if(rule.attemptMode==='first_success')break;continue;}}catch{}
          s.ledger[key]={...s.ledger[key],status:'UNKNOWN'};await save(s);
          throw new FlowError('MANUAL_ACTION_REQUIRED','提交结果无法确认，已锁定该设施/日期/时段，须核实官方预订记录');
        }
        if(e.code==='SLOT_UNAVAILABLE'){
          if(mode==='auto')s.ledger[key]={status:'SLOT_UNAVAILABLE',at:new Date().toISOString()};
          run.slots.push({slot:slot.label,status:'SLOT_UNAVAILABLE',message:e.message});await save(s);continue;
        }
        throw e;
      }
    }
    run.status=mode==='auto'?(successes?'SUCCEEDED':'SLOT_UNAVAILABLE'):(run.slots.some(x=>['DRY_RUN_OK','PREPARED'].includes(x.status))?(mode==='dry_run'?'DRY_RUN_OK':'MANUAL_ACTION_REQUIRED'):'SLOT_UNAVAILABLE');
    run.message=mode==='auto'?`已确认 ${successes} 个预订/已有记录`:(mode==='dry_run'?'页面配置校验完成，没有提交':'页面已准备好，等待你手动提交');
    if(forceDry&&run.status==='DRY_RUN_OK'){s.profile.verified=true;s.profile.verifiedAt=new Date().toISOString();}
  }catch(e){run.status=e.code||'PAGE_CHANGED';run.message=redact(e.message);}
  run.finishedAt=new Date().toISOString();await save(s);
  await notice(`HKUST：${run.status}`,`${rule.facilityName} · ${targetDate} · ${run.message}`);
  return run;
}
async function recover(rebuild=true){
  const s=await state();
  for(const run of s.runs.filter(r=>r.status==='RUNNING')){run.status='MANUAL_ACTION_REQUIRED';run.message='浏览器或扩展已重启，未完成运行需要人工核验，未自动重新提交';run.finishedAt=new Date().toISOString();}
  for(const [key,entry]of Object.entries(s.ledger))if(entry.status==='SUBMITTING')s.ledger[key]={...entry,status:'UNKNOWN'};
  if(rebuild)await reschedule(s);else await save(s);
}
chrome.runtime.onInstalled.addListener(()=>serial(recover));
chrome.runtime.onStartup.addListener(()=>serial(recover));
chrome.action.onClicked.addListener(()=>chrome.runtime.openOptionsPage());
chrome.alarms.onAlarm.addListener(alarm=>{
  if(!alarm.name.startsWith('hkust:'))return;
  serial(async()=>{
    const [,kind,id]=alarm.name.split(':');
    try{if(kind==='pre')await precheck(id);else await execute(id,{scheduled:true});}
    catch(e){const s=await state();await log(s,{ruleId:id,status:e.code||'FAILED',message:redact(e.message),stage:kind});await notice('HKUST 任务需要处理',e.message);}
    if(kind==='run')await reschedule(await state());
  });
});
const internal=new Set(['CONTENT_READY','PICK_RESULT','RECORD_STEP','RECORD_BLOCKED']);
chrome.runtime.onMessage.addListener((msg,sender,respond)=>{
  if(sender.id!==chrome.runtime.id)return;
  const fromContent=sender.tab&&!sender.url?.startsWith(`chrome-extension://${chrome.runtime.id}/`);
  if(fromContent&&!internal.has(msg.type))return;
  if(fromContent&&!safeUrl(sender.tab.url))return;
  if(msg.type==='CANCEL'){
    chrome.storage.local.set({[`cancel:${msg.ruleId}`]:true}).then(()=>respond({ok:true}));return true;
  }
  serial(async()=>{
    const s=await state();
    switch(msg.type){
      case 'STATE':return {...s,now:Date.now()};
      case 'CONTENT_READY':return {recording:s.recordingTab===sender.tab.id};
      case 'SAVE_PREFERENCES':{
        if(!['dry_run','prepare','auto'].includes(msg.mode))throw new FlowError('CONFIG_REQUIRED','执行模式无效');
        s.preferences={...s.preferences,mode:msg.mode};await save(s);return s.preferences;
      }
      case 'SAVE_RULE':{
        const r=validateRule(msg.rule);if(r.mode==='auto'&&!msg.authorized)throw new FlowError('CONFIG_REQUIRED','自动提交需要勾选本人账户授权');
        if(isNative(s.profile)&&(!r.categoryId||!r.location||[...r.slots,...r.fallbackSlots].some(x=>!/^\d{2}:\d{2}$/.test(x.id))))throw new FlowError('CONFIG_REQUIRED','请先同步并选择官网项目、场地和时段');
        r.id=r.id||crypto.randomUUID();r.updatedAt=new Date().toISOString();
        s.preferences={...s.preferences,mode:r.mode};s.rules=s.rules.filter(x=>x.id!==r.id).concat(r);await reschedule(s);return r;
      }
      case 'DELETE_RULE':s.rules=s.rules.filter(r=>r.id!==msg.ruleId);await reschedule(s);return true;
      case 'TOGGLE_RULE':{const r=s.rules.find(x=>x.id===msg.ruleId);if(r)r.enabled=!r.enabled;await reschedule(s);return true;}
      case 'SAVE_PROFILE':{
        if(!safeUrl(msg.profile.entryUrl)||msg.profile.records.url&&!safeUrl(msg.profile.records.url))throw new FlowError('CONFIG_REQUIRED','页面地址必须属于 HKUST FBS');
        s.profile={...msg.profile,verified:false};await save(s);return true;
      }
      case 'OPEN_LOGIN':return chrome.tabs.create({url:s.profile.entryUrl,active:true});
      case 'CHECK_LOGIN':{
        const tab=isNative(s.profile)?await openOfficial(s.profile.entryUrl):await targetTab(s);
        let result;try{result=await auth(tab,s.profile);}finally{if(isNative(s.profile))await chrome.tabs.remove(tab).catch(()=>{});}
        s.authCheckedAt=new Date().toISOString();
        await log(s,{status:'AUTH_OK',stage:'evening_check',message:'当前登录态有效；服务端仍可能在次日使会话失效'});return result;
      }
      case 'INSTALL_NATIVE':{
        s.profile=structuredClone(NATIVE_PROFILE);s.catalog=null;await save(s);return true;
      }
      case 'SYNC_NATIVE':{
        if(!isNative(s.profile))throw new FlowError('CONFIG_REQUIRED','请先启用 HKUST 官网适配');
        let id=s.catalogTab;
        const tab=id?await chrome.tabs.get(id).catch(()=>null):null;
        if(!tab||!safeUrl(tab.url)||new URL(tab.url).pathname!=='/facilities')id=await openOfficial(s.profile.entryUrl);
        else{await chrome.tabs.update(id,{url:s.profile.entryUrl});await ready(id);}
        s.catalogTab=id;await ready(id);await auth(id,s.profile);
        s.catalog=await page(id,{type:'NATIVE_CATALOG',args:{categoryId:msg.categoryId,facilityId:msg.facilityId,facilityName:msg.facilityName,location:msg.location,targetDate:msg.targetDate}});
        await save(s);return s.catalog;
      }
      case 'SCAN':{
        const id=await targetTab(s);s.catalog=await page(id,{type:'SCAN'});await save(s);return s.catalog;
      }
      case 'START_RECORD':{
        const id=await targetTab(s);if(!msg.append)s.profile.steps=[];
        if(msg.records){s.recordTarget='records';s.profile.records.steps=[];}else{s.recordTarget='booking';const tab=await chrome.tabs.get(id);s.profile.entryUrl=new URL(tab.url).origin+new URL(tab.url).pathname+new URL(tab.url).search;}
        s.profile.verified=false;s.recordingTab=id;await save(s);await page(id,{type:'START_RECORD'});await chrome.tabs.update(id,{active:true});return true;
      }
      case 'STOP_RECORD':{const id=s.recordingTab;s.recordingTab=null;await save(s);if(id)await page(id,{type:'STOP_RECORD'}).catch(()=>{});return true;}
      case 'RECORD_STEP':{
        if(s.recordingTab!==sender.tab.id)return false;
        const list=s.recordTarget==='records'?s.profile.records.steps:s.profile.steps;
        if(list.length>=40)throw new FlowError('CONFIG_REQUIRED','最多录制 40 步，请整理流程');
        list.push(msg.step);s.profile.verified=false;await save(s);return true;
      }
      case 'RECORD_BLOCKED':await notice('录制器已阻止实际提交',msg.message);return true;
      case 'PICK':{
        const id=await targetTab(s);s.recordingTab=null;s.pickTab=id;s.pickKey=msg.key;await save(s);
        await page(id,{type:'PICK',key:msg.key});await chrome.tabs.update(id,{active:true});return true;
      }
      case 'PICK_RESULT':{
        if(sender.tab.id!==s.pickTab||msg.key!==s.pickKey)throw new FlowError('CONFIG_REQUIRED','点选请求已过期');
        if(msg.key==='submit'||msg.key==='confirm')s.profile.steps.push({kind:'click',phase:msg.key,variable:'none',value:'',locator:msg.locator});
        else if(msg.key==='records.rows'){
          s.profile.records.rows=msg.locator;const tab=await chrome.tabs.get(sender.tab.id);s.profile.records.url=new URL(tab.url).origin+new URL(tab.url).pathname+new URL(tab.url).search;
        }else if(['authenticated','success','confirmationNumber'].includes(msg.key))s.profile[msg.key]=msg.locator;
        s.profile.verified=false;s.pickKey=null;await save(s);await notice('已保存页面绑定',msg.key);return true;
      }
      case 'EXECUTE':return execute(msg.ruleId,{forceDry:!!msg.forceDry});
      case 'UNLOCK':{
        const entry=s.ledger[msg.key];if(!entry)throw new FlowError('CONFIG_REQUIRED','找不到记录');
        if(msg.confirmedBooked)entry.status='DUPLICATE';else delete s.ledger[msg.key];await log(s,{status:'MANUAL_RECONCILIATION',stage:'reconcile',message:msg.confirmedBooked?'用户核实官方已有预订':'用户核实官方无预订，解除不确定锁'});return true;
      }
      case 'CLEAR_DATA':{
        if(s.runs.some(r=>r.status==='RUNNING'))throw new FlowError('CONFIG_REQUIRED','请等待执行完成后再删除数据');
        await chrome.storage.local.clear();await reschedule(await state());return true;
      }
      default:throw new FlowError('UNKNOWN_MESSAGE','不支持的命令');
    }
  }).then(result=>respond({ok:true,result})).catch(e=>respond({ok:false,error:redact(e.message),code:e.code||'FAILED'}));
  return true;
});
// A MV3 worker can restart without a full browser startup event.
serial(()=>recover(false));
