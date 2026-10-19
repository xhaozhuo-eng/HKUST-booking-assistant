import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import * as core from '../core.js';
async function makeWorker(initial,now=Date.now()){
 let clockNow=now;class Clock extends Date{constructor(...args){super(...(args.length?args:[clockNow]));}static now(){return clockNow;}}
 const storage={hkustExtensionV1:structuredClone(initial)},alarms=new Map(),listeners={};
 const event=name=>({addListener(fn){listeners[name]=fn;}});
 const chrome={storage:{local:{async get(key){return typeof key==='string'?{[key]:structuredClone(storage[key])}:structuredClone(storage);},async set(values){Object.assign(storage,structuredClone(values));},async remove(key){delete storage[key];},async clear(){for(const k in storage)delete storage[k];}}},alarms:{async getAll(){return [...alarms].map(([name,v])=>({name,...v}));},async create(name,values){alarms.set(name,values);},async clear(name){alarms.delete(name);},onAlarm:event('alarm')},notifications:{async create(){}},runtime:{id:'test-extension',onInstalled:event('installed'),onStartup:event('startup'),onMessage:event('message'),async openOptionsPage(){}},action:{onClicked:event('action')},tabs:{async create(){throw Error('Browser page should never be opened by these tests');}}};
 const context=vm.createContext({chrome,crypto:globalThis.crypto,console,URL,Date:Clock,Intl,structuredClone,setTimeout,clearTimeout,...core});
 const source=(await readFile(new URL('../background.js',import.meta.url),'utf8')).replace(/^import .*;\n/,'');
 vm.runInContext(source,context);
 const command=(message)=>new Promise(resolve=>listeners.message(message,{id:'test-extension'},resolve));
 return {storage,alarms,listeners,command,context,advance(ms){clockNow+=ms;},now:()=>clockNow};
}
const initial=()=>({rules:[],profile:structuredClone(core.DEFAULT_PROFILE),runs:[],ledger:{},catalog:null,recordingTab:null,plans:{}});
test('scheduler uses stable alarm IDs, repeated scheduling does not duplicate tasks',async()=>{
 const w=await makeWorker(initial());const r={...structuredClone(core.DEFAULT_RULE),id:'r1',facilityId:'f',facilityName:'Court',slots:[{id:'s',label:'18:00'}]};
 assert.equal((await w.command({type:'SAVE_RULE',rule:r})).ok,true);assert.equal(w.alarms.size,2);
 await w.command({type:'SAVE_RULE',rule:r});assert.equal(w.alarms.size,2);await w.command({type:'TOGGLE_RULE',ruleId:'r1'});assert.equal(w.alarms.size,0);
});
test('browser restart marks interrupted submissions unknown, never resubmits',async()=>{
 const s=initial();s.runs=[{id:'run1',status:'RUNNING',stage:'submit'}];s.ledger.key={status:'SUBMITTING'};
 const w=await makeWorker(s);await vm.runInContext('recover()',w.context);const recovered=w.storage.hkustExtensionV1;assert.equal(recovered.runs[0].status,'MANUAL_ACTION_REQUIRED');assert.equal(recovered.ledger.key.status,'UNKNOWN');
});
test('auto mode cannot be saved without explicit per-rule user authorization',async()=>{
 const w=await makeWorker(initial());const r={...structuredClone(core.DEFAULT_RULE),id:'r1',facilityId:'f',facilityName:'Court',slots:[{id:'s',label:'18:00'}],mode:'auto'};
 assert.equal((await w.command({type:'SAVE_RULE',rule:r})).ok,false);assert.equal(w.storage.hkustExtensionV1.rules.length,0);
});
test('cancel bypasses job queue and stores a durable cancellation signal',async()=>{
 const w=await makeWorker(initial());const result=await w.command({type:'CANCEL',ruleId:'r1'});assert.equal(result.ok,true);assert.equal(w.storage['cancel:r1'],true);
});
test('changing page adapter invalidates prior verification',async()=>{
 const s=initial();s.profile.verified=true;const w=await makeWorker(s);await w.command({type:'SAVE_PROFILE',profile:s.profile});assert.equal(w.storage.hkustExtensionV1.profile.verified,false);
});

test('execution preference remembers all modes across worker restarts',async()=>{
 let w=await makeWorker(initial());assert.equal((await w.command({type:'STATE'})).result.preferences.mode,'dry_run');
 for(const mode of ['prepare','auto','dry_run']){
  assert.equal((await w.command({type:'SAVE_PREFERENCES',mode})).ok,true);
  w=await makeWorker(w.storage.hkustExtensionV1);assert.equal((await w.command({type:'STATE'})).result.preferences.mode,mode);
 }
 assert.equal((await w.command({type:'SAVE_PREFERENCES',mode:'invalid'})).ok,false);
 assert.equal((await w.command({type:'STATE'})).result.preferences.mode,'dry_run');
});
test('mode preference migration preserves latest rule and never changes existing rules',async()=>{
 const s=initial();s.rules=[{id:'old',mode:'dry_run'},{id:'latest',mode:'auto'}];const w=await makeWorker(s);
 assert.equal((await w.command({type:'STATE'})).result.preferences.mode,'auto');
 await w.command({type:'SAVE_PREFERENCES',mode:'prepare'});
 assert.equal(w.storage.hkustExtensionV1.rules[0].mode,'dry_run');assert.equal(w.storage.hkustExtensionV1.rules[1].mode,'auto');
});
test('native automatic rules can be scheduled without successful dry-run',async()=>{
 const s=initial();s.profile=structuredClone(core.NATIVE_PROFILE);const w=await makeWorker(s);
 const rule={...structuredClone(core.DEFAULT_RULE),id:'no-dry-run',categoryId:'3',location:'SPORTS - LG1',facilityId:'2',facilityName:'Badminton Court 1',slots:[{id:'08:00',label:'08:00'}],mode:'auto'};
 const result=await w.command({type:'SAVE_RULE',rule,authorized:true});assert.equal(result.ok,true);assert.equal(w.alarms.size,2);assert.equal(w.storage.hkustExtensionV1.profile.verified,false);assert.equal(w.storage.hkustExtensionV1.preferences.mode,'auto');
});

const scheduledRule=(id,extra={})=>({...structuredClone(core.DEFAULT_RULE),id,facilityId:'f',facilityName:'Court',slots:[{id:'08:00',label:'08:00'}],mode:'auto',...extra});
const scheduledState=(rules,now)=>({...initial(),rules,plans:Object.fromEntries(rules.map(r=>[r.id,{submitAt:now,precheckAt:now-30000,targetDate:'2026-10-26',executionDay:'2026-10-19'}]))});
async function stubExecution(w,status='NETWORK_ERROR'){
 w.context.testStatus=status;w.context.advanceClock=w.advance;w.context.calls=[];
 await vm.runInContext("execute=async(id,args)=>{calls.push({id,...structuredClone(args)});const s=await state();return log(s,{ruleId:id,status:testStatus,targetDate:args.plan.targetDate,slots:[],message:'fixture'});}",w.context);
}
async function fire(w,name){w.listeners.alarm({name});await vm.runInContext('queue',w.context);}
test('simultaneous alarms keep original target even after the first rule advances to tomorrow',async()=>{
 const now=Date.parse('2026-10-19T00:00:00Z'),rules=['a','b','c'].map(id=>scheduledRule(id));const w=await makeWorker(scheduledState(rules,now),now);await stubExecution(w,'SUCCEEDED');
 await vm.runInContext("const oldExecute=execute;execute=async(...args)=>{advanceClock(90000);return oldExecute(...args);};",w.context);
 for(const r of rules)w.listeners.alarm({name:'hkust:run:'+r.id});
 await vm.runInContext('queue',w.context);
 assert.deepEqual(Array.from(w.context.calls,x=>x.plan.targetDate),['2026-10-26','2026-10-26','2026-10-26']);
 assert.deepEqual(Array.from(w.context.calls,x=>x.id),['a','b','c']);
 assert.equal(w.storage.hkustExtensionV1.plans.a.targetDate,'2026-10-27');
 assert.equal(w.storage.hkustExtensionV1.plans.b.targetDate,'2026-10-27');
});
test('pre-submit transient failure uses a durable retry alarm with the same date, then stops on success',async()=>{
 const now=Date.parse('2026-10-19T00:00:00Z'),r=scheduledRule('a'),w=await makeWorker(scheduledState([r],now),now);await stubExecution(w);
 await fire(w,'hkust:run:a');let s=w.storage.hkustExtensionV1;
 assert.equal(s.retryJobs.a.attempt,1);assert.equal(s.retryJobs.a.plan.targetDate,'2026-10-26');assert.equal(s.plans.a.targetDate,'2026-10-27');assert.ok(w.alarms.has('hkust:retry:a'));assert.equal(s.runs[0].retryAt,now+10000);
 w.advance(10000);w.context.testStatus='SUCCEEDED';await fire(w,'hkust:retry:a');
 assert.equal(w.context.calls[1].plan.targetDate,'2026-10-26');assert.equal(w.context.calls[1].attempt,2);assert.equal(w.storage.hkustExtensionV1.retryJobs.a,undefined);assert.equal(w.alarms.has('hkust:retry:a'),false);
});
test('retry resumes after worker restart with original target and deadline',async()=>{
 const now=Date.parse('2026-10-19T00:00:00Z'),r=scheduledRule('a'),w=await makeWorker(scheduledState([r],now),now);await stubExecution(w);await fire(w,'hkust:run:a');
 const resumed=await makeWorker(w.storage.hkustExtensionV1,now+12000);await vm.runInContext('recover()',resumed.context);assert.ok(resumed.alarms.has('hkust:retry:a'));await stubExecution(resumed,'SUCCEEDED');await fire(resumed,'hkust:retry:a');
 assert.equal(resumed.context.calls[0].plan.targetDate,'2026-10-26');assert.equal(resumed.context.calls[0].deadline,now+600000);
});
test('cancelled retry never starts a new execution',async()=>{
 const now=Date.parse('2026-10-19T00:00:00Z'),r=scheduledRule('a'),w=await makeWorker(scheduledState([r],now),now);await stubExecution(w);await fire(w,'hkust:run:a');
 await w.command({type:'CANCEL',ruleId:'a'});w.advance(10000);await fire(w,'hkust:retry:a');
 assert.equal(w.context.calls.length,1);assert.equal(w.storage.hkustExtensionV1.retryJobs.a,undefined);assert.equal(w.storage.hkustExtensionV1.runs[0].status,'CANCELLED');
});
test('retry window ends instead of retrying forever or moving the target',async()=>{
 const now=Date.parse('2026-10-19T00:00:00Z'),r=scheduledRule('a'),w=await makeWorker(scheduledState([r],now),now);await stubExecution(w);await fire(w,'hkust:run:a');
 w.advance(600001);await fire(w,'hkust:retry:a');assert.equal(w.context.calls.length,1);assert.equal(w.storage.hkustExtensionV1.runs[0].status,'RETRY_EXHAUSTED');assert.equal(w.storage.hkustExtensionV1.runs[0].targetDate,'2026-10-26');assert.equal(w.alarms.has('hkust:retry:a'),false);
});
test('only transient preparation errors and unavailable slots retry; auth, mismatch and uncertain submit stop',async()=>{
 const now=Date.parse('2026-10-19T00:00:00Z');
 for(const status of ['NETWORK_ERROR','PAGE_NOT_READY','SLOT_UNAVAILABLE','AUTH_REQUIRED','DATE_MISMATCH','PAGE_CHANGED','MANUAL_ACTION_REQUIRED','CANCELLED','CONFIG_REQUIRED']){
  const r=scheduledRule('a'),w=await makeWorker(scheduledState([r],now),now);await stubExecution(w,status);await fire(w,'hkust:run:a');
  assert.equal(w.alarms.has('hkust:retry:a'),['NETWORK_ERROR','PAGE_NOT_READY','SLOT_UNAVAILABLE'].includes(status),status);
 }
});
test('retry can be disabled and editing or pausing a rule clears pending retry',async()=>{
 const now=Date.parse('2026-10-19T00:00:00Z'),disabled=scheduledRule('a',{retryWindowSeconds:0}),w=await makeWorker(scheduledState([disabled],now),now);await stubExecution(w);await fire(w,'hkust:run:a');assert.equal(w.alarms.has('hkust:retry:a'),false);
 const r=scheduledRule('a');await w.command({type:'SAVE_RULE',rule:r,authorized:true});w.storage.hkustExtensionV1.plans.a={submitAt:now,targetDate:'2026-10-26'};await fire(w,'hkust:run:a');assert.ok(w.alarms.has('hkust:retry:a'));await w.command({type:'TOGGLE_RULE',ruleId:'a'});assert.equal(w.alarms.has('hkust:retry:a'),false);assert.equal(w.storage.hkustExtensionV1.retryJobs.a,undefined);
});
test('partial all-slot success retries missing slots but first-success mode stops',async()=>{
 const w=await makeWorker(initial());
 assert.equal(vm.runInContext("retryable({status:'SUCCEEDED',slots:[{status:'SUCCEEDED'},{status:'SLOT_UNAVAILABLE'}]},{attemptMode:'all'})",w.context),true);
 assert.equal(vm.runInContext("retryable({status:'SUCCEEDED',slots:[{status:'SUCCEEDED'},{status:'SLOT_UNAVAILABLE'}]},{attemptMode:'first_success'})",w.context),false);
});

test('a responsive official page is ready even if unrelated resources keep its loading indicator active',async()=>{
 const w=await makeWorker(initial());let pings=0;
 w.context.chrome.tabs.get=async()=>({url:'https://fbs.hkust.edu.hk/facilities',status:'loading'});
 w.context.chrome.tabs.sendMessage=async(id,msg)=>{assert.equal(msg.type,'PING');pings++;return {ok:true,result:{ready:true}};};
 await vm.runInContext('ready(1)',w.context);assert.equal(pings,1);
});
test('foreign authentication pages never become ready for booking',async()=>{
 const w=await makeWorker(initial());w.context.chrome.tabs.get=async()=>({url:'https://cas.ust.hk/login',status:'complete'});
 await assert.rejects(vm.runInContext('ready(1)',w.context),e=>e.code==='AUTH_REQUIRED');
});

test('worker-only restart restores an interrupted retry alarm without changing other plans',async()=>{
 const now=Date.parse('2026-10-19T00:00:00Z'),r=scheduledRule('a'),s=scheduledState([r],now);
 s.retryJobs={a:{plan:structuredClone(s.plans.a),attempt:1,nextAt:null,deadline:now+600000}};
 const w=await makeWorker(s,now+12000);await vm.runInContext('queue',w.context);
 assert.ok(w.alarms.has('hkust:retry:a'));assert.equal(w.alarms.has('hkust:run:a'),false);
 assert.equal(w.storage.hkustExtensionV1.plans.a.targetDate,'2026-10-26');
 await stubExecution(w,'SUCCEEDED');await fire(w,'hkust:retry:a');
 assert.equal(w.context.calls[0].attempt,2);assert.equal(w.context.calls[0].plan.targetDate,'2026-10-26');
 assert.equal(w.storage.hkustExtensionV1.retryJobs.a,undefined);
});
