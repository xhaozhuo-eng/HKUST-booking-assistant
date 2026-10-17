import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import * as core from '../core.js';
async function makeWorker(initial){
 const storage={hkustExtensionV1:structuredClone(initial)},alarms=new Map(),listeners={};
 const event=name=>({addListener(fn){listeners[name]=fn;}});
 const chrome={storage:{local:{async get(key){return typeof key==='string'?{[key]:structuredClone(storage[key])}:structuredClone(storage);},async set(values){Object.assign(storage,structuredClone(values));},async remove(key){delete storage[key];},async clear(){for(const k in storage)delete storage[k];}}},alarms:{async getAll(){return [...alarms].map(([name,v])=>({name,...v}));},async create(name,values){alarms.set(name,values);},async clear(name){alarms.delete(name);},onAlarm:event('alarm')},notifications:{async create(){}},runtime:{id:'test-extension',onInstalled:event('installed'),onStartup:event('startup'),onMessage:event('message'),async openOptionsPage(){}},action:{onClicked:event('action')},tabs:{async create(){throw Error('Browser page should never be opened by these tests');}}};
 const context=vm.createContext({chrome,crypto:globalThis.crypto,console,URL,Date,Intl,structuredClone,setTimeout,clearTimeout,...core});
 const source=(await readFile(new URL('../background.js',import.meta.url),'utf8')).replace(/^import .*;\n/,'');
 vm.runInContext(source,context);
 const command=(message)=>new Promise(resolve=>listeners.message(message,{id:'test-extension'},resolve));
 return {storage,alarms,listeners,command,context};
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
