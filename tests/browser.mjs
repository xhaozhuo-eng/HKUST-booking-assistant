import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
import {resolve} from 'node:path';
import {mkdir} from 'node:fs/promises';
import {DEFAULT_PROFILE,DEFAULT_RULE} from '../core.js';
const root=resolve('.');await mkdir('artifacts',{recursive:true});
let mode='normal',bookings=[],submissions=0;
const recordsHtml=()=>`<!doctype html><html><body><button id="logout" type="button">Log out</button><h1>Booking Records</h1><table id="records"><thead><tr><th>Facility Date Slot Confirmation</th></tr></thead><tbody>${bookings.map(b=>`<tr><td>${b.facility} ${b.date} ${b.slot} ${b.number}</td></tr>`).join('')}</tbody></table></body></html>`;
const facilityHtml=()=>`<!doctype html><html><head><title>Mock FBS booking fixture</title></head><body><button id="logout" type="button">Log out</button><h1>Sports facilities · Test fixture</h1>${mode==='auth'?'<input type="password" name="password">':''}${mode==='challenge'?'<div id="captcha">Verification required</div>':''}<label>Facility<select name="facility" id="facility"><option value="court-12">Badminton Court 12</option></select></label><label>Date<input id="date" name="date" type="date"></label><label>Time slot<select name="slot" id="slot"><option value="1800" ${mode==='full'?'disabled':''}>18:00–19:00</option><option value="1900">19:00–20:00</option></select></label><p id="summary"></p><button id="submit" type="button">Confirm</button><div id="success" hidden>Booking confirmed</div><span id="confirmation" hidden></span><script>
function summary(){document.getElementById('summary').textContent=document.getElementById('facility').selectedOptions[0].text+' '+document.getElementById('date').value+' '+document.getElementById('slot').selectedOptions[0].text;}document.querySelectorAll('select,input').forEach(x=>x.addEventListener('change',summary));document.getElementById('submit').onclick=async()=>{const body={facility:document.getElementById('facility').selectedOptions[0].text,date:document.getElementById('date').value,slot:document.getElementById('slot').selectedOptions[0].text};const response=await fetch('/mock-submit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});if(!response.ok)return;const result=await response.json();document.getElementById('success').hidden=false;document.getElementById('confirmation').hidden=false;document.getElementById('confirmation').textContent=result.number;};</script></body></html>`;
const context=await chromium.launchPersistentContext(resolve('artifacts/browser-test-profile-'+Date.now()),{executablePath:process.env.TEST_BROWSER_PATH||undefined,headless:true,args:[`--disable-extensions-except=${root}`,`--load-extension=${root}`],viewport:{width:1440,height:1100}});
try{
  await context.route('https://fbs.hkust.edu.hk/**',async route=>{
    const url=new URL(route.request().url());
    if(url.pathname==='/mock-submit'){
      submissions++;
      if(mode==='uncertain'){await route.abort();return;}
      const data=route.request().postDataJSON(),number='TEST-BK-'+submissions;bookings.push({...data,number});await route.fulfill({json:{number}});return;
    }
    await route.fulfill({contentType:'text/html; charset=utf-8',body:url.pathname==='/bookings'?recordsHtml():facilityHtml()});
  });
  let worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');const id=new URL(worker.url()).host;
  const options=await context.newPage();await options.goto(`chrome-extension://${id}/options.html`);
  const command=async(type,data={})=>options.evaluate(async({type,data})=>chrome.runtime.sendMessage({type,...data}),{type,data});
  const state=async()=>(await command('STATE')).result;
  const locator=(tag,id)=>({tag,attrs:{id}});
  const p={...structuredClone(DEFAULT_PROFILE),identity:'integration-test',authenticated:locator('button','logout'),success:locator('div','success'),confirmationNumber:locator('span','confirmation'),records:{url:'https://fbs.hkust.edu.hk/bookings',rows:locator('table','records'),steps:[]},steps:[{kind:'select',variable:'facility',phase:'prepare',locator:locator('select','facility')},{kind:'input',variable:'date',phase:'prepare',locator:locator('input','date')},{kind:'select',variable:'slot',phase:'prepare',locator:locator('select','slot')},{kind:'click',variable:'none',phase:'submit',locator:locator('button','submit')}]};
  assert.equal((await command('SAVE_PROFILE',{profile:p})).ok,true);
  const r={...structuredClone(DEFAULT_RULE),id:'integration-rule',facilityId:'court-12',facilityName:'Badminton Court 12',slots:[{id:'1800',label:'18:00–19:00'}],enabled:false};
  assert.equal((await command('SAVE_RULE',{rule:r})).ok,true);
  let result=await command('EXECUTE',{ruleId:r.id,forceDry:true});assert.equal(result.result.status,'DRY_RUN_OK',JSON.stringify(result));assert.equal(submissions,0);console.log('PASS real content script dry-run never clicks submit');
  r.mode='auto';assert.equal((await command('SAVE_RULE',{rule:r,authorized:true})).ok,true);
  result=await command('EXECUTE',{ruleId:r.id});assert.equal(result.result.status,'SUCCEEDED',JSON.stringify(result));assert.equal(submissions,1);assert.equal(bookings.length,1);console.log('PASS automatic selection, review, submit, confirmation and post-submit records');
  result=await command('EXECUTE',{ruleId:r.id});assert.equal(result.result.status,'SUCCEEDED');assert.equal(submissions,1);console.log('PASS repeated run does not submit twice');
  let s=await state();s.ledger={};await options.evaluate(s=>chrome.storage.local.set({hkustExtensionV1:s}),s);
  result=await command('EXECUTE',{ruleId:r.id});assert.equal(submissions,1);assert.equal(result.result.slots[0].status,'DUPLICATE');console.log('PASS official pre-submit records detect duplicate even without local lock');
  // Clear fixture records, then make the target full and use fallback.
  bookings=[];s=await state();s.ledger={};await options.evaluate(s=>chrome.storage.local.set({hkustExtensionV1:s}),s);mode='full';r.fallbackSlots=[{id:'1900',label:'19:00–20:00'}];await command('SAVE_RULE',{rule:r,authorized:true});
  result=await command('EXECUTE',{ruleId:r.id});assert.equal(result.result.status,'SUCCEEDED',JSON.stringify(result));assert.equal(bookings[0].slot,'19:00–20:00');console.log('PASS full target slot selects the configured fallback');
  for(const [testMode,expected] of [['auth','AUTH_REQUIRED'],['challenge','MANUAL_ACTION_REQUIRED']]){
    mode=testMode;s=await state();s.ledger={};await options.evaluate(s=>chrome.storage.local.set({hkustExtensionV1:s}),s);const count=submissions;
    result=await command('EXECUTE',{ruleId:r.id});assert.equal(result.result.status,expected,JSON.stringify(result));assert.equal(submissions,count);console.log(`PASS ${testMode} blocks submission`);
  }
  mode='normal';p.steps[1].locator=locator('input','missing-date');await command('SAVE_PROFILE',{profile:p});const count=submissions;result=await command('EXECUTE',{ruleId:r.id,forceDry:true});assert.equal(result.result.status,'PAGE_CHANGED',JSON.stringify(result));assert.equal(submissions,count);console.log('PASS changed date element stops safely');
  p.steps[1].locator=locator('input','date');await command('SAVE_PROFILE',{profile:p});await command('EXECUTE',{ruleId:r.id,forceDry:true});
  bookings=[];s=await state();s.ledger={};await options.evaluate(s=>chrome.storage.local.set({hkustExtensionV1:s}),s);mode='uncertain';
  result=await command('EXECUTE',{ruleId:r.id});assert.equal(result.result.status,'MANUAL_ACTION_REQUIRED',JSON.stringify(result));const uncertainCount=submissions;result=await command('EXECUTE',{ruleId:r.id});assert.equal(submissions,uncertainCount);assert.equal(result.result.status,'MANUAL_ACTION_REQUIRED');console.log('PASS ambiguous submission result locks key and cannot retry automatically');
  mode='normal';
  const official=await context.newPage();await official.goto('https://fbs.hkust.edu.hk/facilities?fixture=recording');await official.bringToFront();
  result=await command('SCAN');assert.equal(result.ok,true,JSON.stringify(result));assert.ok(result.result.selects.length>=2);console.log('PASS scan reads actual DOM option IDs');
  assert.equal((await command('START_RECORD')).ok,true);
  await official.locator('#facility').selectOption('court-12');await official.locator('#date').fill('2026-10-24');await official.locator('#slot').selectOption('1900');
  const beforeRecordSubmit=submissions;await official.locator('#submit').click();assert.equal(submissions,beforeRecordSubmit);
  await command('STOP_RECORD');s=await state();assert.equal(s.profile.steps.length,3,JSON.stringify(s.profile.steps));console.log('PASS real recording captures input/select but blocks final submission');
  await command('PICK',{key:'authenticated'});await official.locator('#logout').click();
  await new Promise(r=>setTimeout(r,250));s=await state();assert.equal(s.profile.authenticated.attrs.id,'logout');console.log('PASS element picker binds real DOM without clicking through');
  await options.bringToFront();await options.locator('[data-tab="rules"]').click();
  await options.locator('#facility-id').fill('ui-test-court');await options.locator('#facility-name').fill('UI test court');
  await options.locator('#slot-id').fill('1100');await options.locator('#slot-label').fill('11:00–12:00');await options.locator('#add-slot').click();
  await options.locator('#slot-id').fill('1200');await options.locator('#slot-label').fill('12:00–13:00');await options.locator('#add-fallback').click();
  await options.locator('#date-mode').selectOption('fixed_date');await options.locator('#target-date').fill('2026-11-30');await options.locator('#enabled').uncheck();
  await options.locator('#rule-form button[type="submit"]').click();await options.waitForFunction(()=>document.querySelectorAll('.rule-item').length===2);
  s=await state();const uiRule=s.rules.find(r=>r.facilityId==='ui-test-court');assert.equal(uiRule.targetDate,'2026-11-30');assert.equal(uiRule.fallbackSlots[0].id,'1200');console.log('PASS settings form saves real facility/date/target/fallback selections');
  await options.screenshot({path:'artifacts/settings-desktop.png',fullPage:true});
  await options.locator('[data-tab="adapter"]').click();await options.screenshot({path:'artifacts/adapter-desktop.png',fullPage:true});
  await options.locator('[data-tab="rules"]').click();await options.setViewportSize({width:390,height:900});await options.screenshot({path:'artifacts/settings-mobile.png',fullPage:true});
  const overflow=await options.evaluate(()=>document.documentElement.scrollWidth>innerWidth);assert.equal(overflow,false);console.log('PASS mobile settings have no horizontal overflow');
  console.log('BROWSER TESTS PASSED');
}finally{await context.close();}
