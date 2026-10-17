(() => {
  if (globalThis.__hkustAssistantLoaded) return;
  globalThis.__hkustAssistantLoaded = true;
  let recorder = false, picker = null, lastTarget = null, dock = null;
  const norm = v => String(v || '').normalize('NFKC').replace(/\s+/g, ' ').trim();
  const visible = e => e && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden';
  const interactive = 'button,a,input,select,[role="button"],[role="radio"],[role="option"],[role="tab"],label';
  const send = message => chrome.runtime.sendMessage(message).catch(() => {});
  const fail = (code, message) => {const e = new Error(message); e.code = code; throw e;};
  const native=globalThis.HKUSTNative?.({guard,fail});
  const privateField = e => e.matches('input[type="password"],input[type="hidden"],input[type="email"]') || /pass|token|secret|captcha|otp|username|login|account|email/i.test(`${e.name} ${e.id} ${e.autocomplete}`);
  function labelOf(e) {
    return norm(e.getAttribute('aria-label') || e.labels?.[0]?.innerText || e.getAttribute('title') || (e.tagName === 'INPUT' ? e.placeholder : '') || '');
  }
  function describe(e) {
    const attrs = {};
    for (const key of ['id','name','data-id','data-facility-id','data-slot-id','data-date','datetime','role','type']) {
      const val = e.getAttribute(key);
      if (val && val.length < 160 && !/token|session|password/i.test(key)) attrs[key] = val;
    }
    return {tag:e.tagName.toLowerCase(),label:labelOf(e),text:norm(e.innerText || (e.type==='submit'?e.value:'')).slice(0,160),attrs};
  }
  function allVisible(selector = '*') { return [...document.querySelectorAll(selector)].filter(e => visible(e) && !e.closest('#hkust-assistant-dock')); }
  function byLocator(locator, optional = false) {
    if (!locator) { if (optional) return null; fail('PAGE_CHANGED','缺少页面元素绑定'); }
    const candidates = allVisible(locator.tag || '*');
    const tests = [];
    if (locator.label) tests.push(e => labelOf(e) === locator.label);
    if (locator.text) tests.push(e => norm(e.innerText || e.value) === locator.text);
    for (const [k,v] of Object.entries(locator.attrs || {})) if (!['role','type'].includes(k)) tests.push(e=>e.getAttribute(k)===v);
    // Require a unique semantic match. Generic tags alone cannot select an element.
    const scored = candidates.map(e=>({e,score:tests.reduce((n,t)=>n+Number(t(e)),0)})).filter(x=>x.score>0);
    if (scored.length) {
      scored.sort((a,b)=>b.score-a.score);
      const top=scored.filter(x=>x.score===scored[0].score);
      if(top.length===1) return top[0].e;
    }
    if(optional) return null;
    fail('PAGE_CHANGED',`无法唯一定位：${locator.label || locator.text || JSON.stringify(locator.attrs)}。请重新扫描或录制。`);
  }
  function guard() {
    if(document.querySelector('input[type="password"]') || /\/login(?:[/?]|$)|\/casservice/i.test(location.pathname)) fail('AUTH_REQUIRED','登录已失效，请手动完成 CAS 登录');
    const challenges=allVisible('iframe,input,[class],[id]').filter(e=>{
      if(e.closest('#hkust-assistant-dock')) return false;
      const key=`${e.id} ${e.className} ${e.getAttribute('src')||''} ${e.name||''}`;
      return /captcha|recaptcha|hcaptcha|turnstile|duo-frame|one.?time.?password|otp-input/i.test(key);
    });
    if(challenges.length) fail('MANUAL_ACTION_REQUIRED','检测到验证码或多因素认证，已停止自动操作');
    const text=norm(document.body.innerText);
    if(/too many requests|rate limit|access denied|unusual activity|异常访问|操作过于频繁/i.test(text)) fail('MANUAL_ACTION_REQUIRED','平台要求人工处理或限制访问，已停止自动操作');
  }
  function status(authenticated) {
    guard();
    const marker=byLocator(authenticated,true);
    if(!marker) fail('AUTH_REQUIRED','未找到已绑定的登录标记；需要重新登录或重新绑定');
    return {authenticated:true,path:location.origin+location.pathname,title:document.title};
  }
  function variableValue(step,vars) {
    if(step.variable==='facility') return {id:vars.facilityId,label:vars.facilityName};
    if(step.variable==='slot') return vars.slot;
    if(step.variable==='date') return {id:vars.targetDate,label:vars.formattedDate,date:vars.targetDate};
    return {id:step.value,label:step.value};
  }
  function dynamicClick(step,value) {
    const candidates=allVisible(interactive+',td[data-date],[data-slot-id],[data-facility-id]');
    const identifiers=['value','data-id','data-slot-id','data-facility-id','data-date','datetime'];
    const exact=candidates.filter(e=>identifiers.some(k=>[value.id,value.date].filter(Boolean).includes(e.getAttribute(k))) || norm(e.innerText||e.getAttribute('aria-label'))===value.label);
    const reduced=exact.filter(e=>!exact.some(x=>x!==e&&e.contains(x)));
    if(reduced.length===1) return reduced[0];
    if(reduced.length===0) fail(step.variable==='slot'?'SLOT_UNAVAILABLE':'PAGE_CHANGED',`页面没有目标${step.variable}：${value.label}`);
    fail('PAGE_CHANGED',`目标 ${value.label} 对应多个元素，不能安全点击`);
  }
  async function perform(step,vars,auth) {
    status(auth);
    if(step.kind==='wait') { await new Promise(r=>setTimeout(r,Math.min(Number(step.waitMs)||500,5000))); return {ok:true}; }
    const value=variableValue(step,vars);
    const e=step.kind==='click'&&step.variable&&step.variable!=='none'?dynamicClick(step,value):byLocator(step.locator);
    if(e.disabled||e.getAttribute('aria-disabled')==='true'||/\b(full|unavailable|sold out)\b|已满|額滿/.test(norm(e.innerText).toLowerCase())) fail('SLOT_UNAVAILABLE','目标时段已满或不可选择');
    if(step.kind==='select') {
      const byId=[...e.options].filter(o=>o.value===value.id);
      const choices=byId.length?byId:[...e.options].filter(o=>norm(o.text)===value.label);
      if(choices.length!==1||choices[0].disabled) fail(step.variable==='slot'?'SLOT_UNAVAILABLE':'DATE_MISMATCH',`平台没有唯一可用选项 ${value.label}`);
      e.value=choices[0].value;
      e.dispatchEvent(new Event('input',{bubbles:true})); e.dispatchEvent(new Event('change',{bubbles:true}));
      if(e.isConnected&&e.value!==choices[0].value) fail('PAGE_CHANGED','平台没有保留所选值');
      return {ok:true,selected:choices[0].text};
    }
    if(step.kind==='input') {
      if(privateField(e)) fail('MANUAL_ACTION_REQUIRED','不会自动输入凭证或验证码');
      const setter=Object.getOwnPropertyDescriptor(e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value')?.set;
      if(!setter) fail('PAGE_CHANGED','输入控件不受支持');
      const inputValue=step.variable==='date'&&e.type!=='date'?vars.formattedDate:value.id;
      setter.call(e,inputValue); e.dispatchEvent(new Event('input',{bubbles:true})); e.dispatchEvent(new Event('change',{bubbles:true}));
      if(e.isConnected&&e.value!==inputValue) fail('DATE_MISMATCH','日期控件实际值与目标值不同');
      if(e.isConnected&&e.checkValidity&&!e.checkValidity()) fail('DATE_MISMATCH','平台日期/控件范围与规则不一致，停止提交');
      return {ok:true};
    }
    if(step.kind==='click') {
      if(step.readOnly&&/delete|cancel|confirm|reserve|book now|提交|取消|删除|確認|确认|預訂|预订/i.test(`${e.getAttribute('href')||''} ${e.innerText||e.value||''}`)&&!/^(my bookings|booking records|我的预订|預訂紀錄|预订记录)$/i.test(norm(e.innerText))) fail('CONFIG_REQUIRED','预订记录查询包含可能写入或取消的操作，已停止');
      if(e.tagName==='A'&&e.href) {
        const u=new URL(e.href,location.href);
        if(u.origin!==location.origin||!/^(https:)$/.test(u.protocol)) fail('PAGE_CHANGED','录制步骤将离开当前官方站点，已停止');
      }
      if(step.phase!=='submit'&&step.phase!=='confirm'&&e.matches('button,input[type="submit"]')&&/^(confirm|submit|book now|reserve|確認|确认|提交|確定預訂)$/i.test(norm(e.innerText||e.value))) fail('CONFIG_REQUIRED','此按钮看似提交操作，必须显式标记为提交阶段');
      e.click(); return {ok:true};
    }
    fail('PAGE_CHANGED','未知的录制步骤');
  }
  function review(vars,auth) {
    status(auth);
    // Values entered into controls alone are insufficient; require a visible booking summary.
    const chunks=[],walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);
    while(walker.nextNode()) {
      const e=walker.currentNode.parentElement;
      if(e&&visible(e)&&!e.closest('select,option,input,textarea,script,style,#hkust-assistant-dock')) chunks.push(walker.currentNode.nodeValue);
    }
    const text=norm(chunks.join(' ')).replace(/\s/g,'').toLowerCase();
    const parts=[vars.facilityName,vars.formattedDate,vars.slot.label];
    if(parts.some(v=>!text.includes(norm(v).replace(/\s/g,'').toLowerCase()))) fail('DATE_MISMATCH','提交前页面未同时展示目标设施、完整日期和时段；请检查录制流程和日期格式');
    return {ok:true};
  }
  function rows(locator) {
    guard();
    const exemplar=byLocator(locator,true);
    if(!exemplar) fail('PAGE_CHANGED','记录页找不到绑定的预订行/空列表容器，不能确认是否已有预订');
    const descendants=[...exemplar.querySelectorAll('tbody tr,[role="row"],li,article')].filter(visible);
    if(descendants.length) return descendants.map(e=>norm(e.innerText).slice(0,1600));
    if(exemplar.matches('table,tbody,[role="table"],[role="grid"],ul,[data-booking-records]')) return [];
    const row=exemplar.closest('tr,[role="row"],li,article')||exemplar;
    const siblings=row.parentElement?[...row.parentElement.children].filter(x=>x.tagName===row.tagName&&visible(x)):[row];
    return siblings.map(e=>norm(e.innerText).slice(0,1600));
  }
  function scan() {
    guard();
    const selects=allVisible('select').filter(e=>!privateField(e)).map(e=>({locator:describe(e),label:labelOf(e),options:[...e.options].filter(o=>o.value&&!o.disabled).map(o=>({id:o.value,label:norm(o.text)}))}));
    const facilities=allVisible('[data-facility-id]').map(e=>({id:e.dataset.facilityId,label:norm(e.innerText),locator:describe(e)}));
    const slots=allVisible('[data-slot-id]').map(e=>({id:e.dataset.slotId,label:norm(e.innerText),locator:describe(e)}));
    const dates=allVisible('input[type="date"],select[name*="date"],[data-date]').map(e=>({locator:describe(e),value:e.value||e.dataset.date,min:e.min,max:e.max}));
    return {path:location.origin+location.pathname,selects,facilities,slots,dates,scannedAt:new Date().toISOString()};
  }
  function renderDock() {
    dock?.remove();
    if(!recorder&&!picker) return;
    dock=document.createElement('div'); dock.id='hkust-assistant-dock';
    dock.style.cssText='position:fixed;z-index:2147483647;top:12px;right:12px;max-width:400px;background:#102a43;color:white;padding:18px;border-radius:12px;font:14px/1.6 system-ui;box-shadow:0 8px 36px #0005';
    const title=document.createElement('strong'); title.textContent=picker?`点选：${picker}（Esc 取消）`:'HKUST 正在录制准备步骤';
    const desc=document.createElement('p'); desc.textContent=picker?'点击要绑定的元素。本次点击会被拦截，不会执行原操作。':'照常选择设施、日期和时段。提交按钮会被拦截；请回设置页用「点选提交按钮」绑定。';
    const stop=document.createElement('button'); stop.textContent='结束 / 取消'; stop.onclick=()=>{recorder=false;picker=null;send({type:'STOP_RECORD'});renderDock();};
    dock.append(title,desc,stop); document.documentElement.append(dock);
  }
  document.addEventListener('click',event=>{
    if(event.composedPath().some(e=>e.id==='hkust-assistant-dock')) return;
    if(picker) {
      event.preventDefault();event.stopImmediatePropagation();
      const e=picker==='records.rows'?(event.target.closest('table,[role="table"],[role="grid"],ul,[data-booking-records]')||event.target):(event.target.closest(interactive)||event.target);
      const key=picker;picker=null;send({type:'PICK_RESULT',key,locator:describe(e)});renderDock();return;
    }
    if(!recorder) return;
    const e=event.target.closest('a,button,input[type="submit"],[role="button"],[role="radio"],[role="tab"]');
    if(!e||privateField(e)) return;
    if(e.matches('input[type="submit"],button')&&(/confirm|submit|book now|reserve|確認|确认|提交|確定預訂/i.test(norm(e.innerText||e.value))||e.type==='submit')) {
      event.preventDefault();event.stopImmediatePropagation();
      send({type:'RECORD_BLOCKED',message:'提交按钮已拦截。请在设置页通过点选绑定提交步骤。'});return;
    }
    send({type:'RECORD_STEP',step:{kind:'click',phase:'prepare',variable:'none',value:'',locator:describe(e)}});
  },true);
  document.addEventListener('change',event=>{
    if(!recorder||event.target.closest('#hkust-assistant-dock')||privateField(event.target)) return;
    const e=event.target;if(!e.matches('select,input[type="date"],input[type="time"],input[type="number"]'))return;
    send({type:'RECORD_STEP',step:{kind:e.tagName==='SELECT'?'select':'input',phase:'prepare',variable:e.type==='date'?'date':'none',value:e.value,locator:describe(e)}});
  },true);
  document.addEventListener('keydown',e=>{if(e.key==='Escape'){picker=null;recorder=false;send({type:'STOP_RECORD'});renderDock();}});
  chrome.runtime.onMessage.addListener((msg,sender,respond)=>{
    if(sender.id!==chrome.runtime.id) return;
    (async()=>{
      switch(msg.type) {
        case 'PING':return {ok:true};
        case 'NATIVE_AUTH':return native.authenticate(msg.accountHash);
        case 'NATIVE_CATALOG':return native.catalog(msg.args);
        case 'NATIVE_PREPARE':return native.prepare(msg.vars);
        case 'NATIVE_REVIEW':return native.review(msg.vars);
        case 'NATIVE_SUBMIT':return native.submit(msg.vars);
        case 'NATIVE_RECORDS':return native.records(msg.vars);
        case 'STATUS':return status(msg.authenticated);
        case 'SCAN':return scan();
        case 'START_RECORD':recorder=true;picker=null;renderDock();return {ok:true};
        case 'STOP_RECORD':recorder=false;picker=null;renderDock();return {ok:true};
        case 'PICK':recorder=false;picker=msg.key;renderDock();return {ok:true};
        case 'STEP':return perform(msg.step,msg.vars,msg.authenticated);
        case 'REVIEW':return review(msg.vars,msg.authenticated);
        case 'ROWS':return rows(msg.locator);
        case 'RESULT': {
          guard();
          const success=byLocator(msg.success,true),number=byLocator(msg.confirmationNumber,true);
          return {success:!!success,confirmationNumber:success&&number?norm(number.innerText||number.value).slice(0,180):''};
        }
        default:fail('UNKNOWN_MESSAGE','不支持的页面消息');
      }
    })().then(result=>respond({ok:true,result})).catch(e=>respond({ok:false,code:e.code||'PAGE_CHANGED',error:e.message}));
    return true;
  });
  send({type:'CONTENT_READY'}).then(state=>{if(state?.recording){recorder=true;renderDock();}});
})();
