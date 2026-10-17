/* HKUST Drupal adapter, inspected against the authenticated site on 2026-10-17.
 * Uses native UI controls only. No cookies, passwords, hidden fields or private APIs. */
globalThis.HKUSTNative = ({guard,fail}) => {
  const norm=v=>String(v||'').normalize('NFKC').replace(/\s+/g,' ').trim();
  const visible=e=>e&&e.getClientRects().length>0&&getComputedStyle(e).visibility!=='hidden';
  const all=s=>[...document.querySelectorAll(s)];
  const named=name=>all('[name]').filter(e=>e.name===name);
  const one=name=>{const a=named(name).filter(visible);if(a.length!==1)fail('PAGE_CHANGED',`官网控件已变化：${name}`);return a[0];};
  const pause=ms=>new Promise(r=>setTimeout(r,ms));
  function uiClick(e){
    // Drupal binds AJAX submit inputs to mousedown, then protects the click from submitting twice.
    e.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,cancelable:true,button:0}));
    e.dispatchEvent(new MouseEvent('mouseup',{bubbles:true,cancelable:true,button:0}));
    e.click();
  }
  let prepared=null;
  async function settled(expected=()=>true,phase='operation'){
    let last=Date.now(),previous='';const began=Date.now();
      do{
        guard();
        const busy=all('.ajax-progress,.ajax-progress-fullscreen,[aria-busy="true"]').some(visible);
        // The homepage carousel mutates constantly. Track booking controls, not unrelated page animation.
        const signature=JSON.stringify(all('select[name^="filters"],input[name^="filters"],input[name^="selection"],input[name^="select_date_"]').map(e=>[e.name,e.value,e.checked,e.disabled,e.options?[...e.options].map(o=>o.value):null]))+norm(dialog()?.innerText);
        if(signature!==previous){previous=signature;last=Date.now();}
        if(Date.now()-began>1000&&!busy&&Date.now()-last>650&&expected())return;
        await pause(180);
      }while(Date.now()-began<35000);
      fail('NETWORK_ERROR',`官网响应超时；已停止当前操作，没有自动重复提交（${phase}）`);
  }
  async function authenticate(expected){
    guard();
    const logout=all('a[href]').filter(e=>new URL(e.href).pathname==='/user/logout');
    if(!logout.some(visible))fail('AUTH_REQUIRED','官网登录已失效，请在助手浏览器中重新登录');
    const accounts=new Set();
    for(const link of logout){let e=link;for(let i=0;e&&i<5;i++,e=e.parentElement){const m=(e.innerText||'').match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi);if(m?.length){m.forEach(v=>accounts.add(v.toLowerCase()));break;}}}
    if(accounts.size!==1)fail('AUTH_REQUIRED','无法唯一确认当前登录账户，停止提交');
    const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode([...accounts][0]));
    const accountHash=[...new Uint8Array(bytes)].map(x=>x.toString(16).padStart(2,'0')).join('');
    if(expected&&expected!==accountHash)fail('AUTH_REQUIRED','当前官网登录账户与配置账户不同，请切回原账户');
    return {authenticated:true,accountHash};
  }
  function dialog(){return all('.ui-dialog[role="dialog"]').find(visible);}
  async function notices(){
    const d=dialog();if(!d)return;
    const text=norm(d.innerText);
    if(d.querySelector('form')||!(/Fok Ying Tung Sports Center will be open for jogging and casual exercise/.test(text)||/no-show and your booking right will be suspended for 4 weeks/.test(text)))fail('MANUAL_ACTION_REQUIRED','官网出现新的提示，请在浏览器中查看后重试');
    const b=[...d.querySelectorAll('button')].filter(e=>visible(e)&&norm(e.innerText)==='Confirm');
    if(b.length!==1)fail('PAGE_CHANGED','官网提示按钮已变化');b[0].click();await settled();
  }
  async function choose(name,value){
    const e=one(name);const o=[...e.options].find(o=>o.value===String(value)&&!o.disabled);
    if(!o)fail('PAGE_CHANGED','官网已没有所选设施或分类，请重新同步');
    if(e.value===o.value)return;
    e.value=o.value;e.dispatchEvent(new Event('change',{bubbles:true}));
    await settled(()=>named(name).some(x=>x.value===String(value)),`filter:${name}`);await notices();
  }
  function readCatalog(){
    const options=name=>[...one(name).options].filter(o=>o.value&&o.value!=='_none').map(o=>({id:o.value,label:norm(o.text),location:o.parentElement.tagName==='OPTGROUP'?o.parentElement.label:'',disabled:o.disabled}));
    const date=one('filters[date]');
    const slots=named('selection[timeslot_wrapper][timeslots]').map(e=>({id:e.value,label:norm(e.labels?.[0]?.innerText||e.value),disabled:e.disabled}));
    const slotSuggestions=slots.length?[]:Array.from({length:14},(_,i)=>{const start=String(i+8).padStart(2,'0');return {id:`${start}:00`,label:`${start}:00（预设开始时间）`,suggested:true};});
    return {native:true,path:location.origin+location.pathname,scannedAt:new Date().toISOString(),categories:options('filters[facility_type]'),categoryId:one('filters[facility_type]').value,facilities:options('filters[facility]'),facilityId:one('filters[facility]').value,slots,slotSuggestions,targetDate:date.value,dateRange:{min:date.min,max:date.max},selects:[],dates:[]};
  }
  async function search(vars){
    prepared=null;
    if(!vars.categoryId)fail('CONFIG_REQUIRED','请先在设置页选择设施项目');
    await choose('filters[facility_type]',vars.categoryId);
    await choose('filters[facility]',vars.facilityId);
    const option=one('filters[facility]').selectedOptions[0];
    if(vars.facilityName&&norm(option.text)!==norm(vars.facilityName))fail('PAGE_CHANGED','设施 ID 对应的名称已变化，请重新同步');
    const locationName=option.parentElement.tagName==='OPTGROUP'?option.parentElement.label:'';
    if(vars.location&&norm(locationName)!==norm(vars.location))fail('PAGE_CHANGED','设施位置与配置不一致');
    const e=one('filters[date]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,vars.targetDate);
    if(!e.checkValidity()||e.value!==vars.targetDate)fail('DATE_MISMATCH','目标日期不在官网可选范围内');
    e.dispatchEvent(new Event('change',{bubbles:true}));await settled(()=>true,'date-filter');
    const search=named('search').filter(visible);
    if(search.length===1){uiClick(search[0]);await settled(()=>named('selection[timeslot_wrapper][timeslots]').length>0||!!document.querySelector('[data-drupal-selector="edit-selection"]'),'calendar-results');}
    // Pin the full calendar date as well as the filter value. This avoids a stale calendar selection.
    const day=named(`select_date_${vars.targetDate}`).filter(visible);
    if(day.length!==1||day[0].disabled)fail('DATE_MISMATCH','官网日历没有可选择的目标日期');
    uiClick(day[0]);await settled(()=>true,'calendar-date');
    return readCatalog();
  }
  async function catalog(args){
    guard();
    if(args.facilityId&&args.targetDate)return search(args);
    if(args.categoryId)await choose('filters[facility_type]',args.categoryId);
    return readCatalog();
  }
  function selection(vars){
    if(one('filters[facility_type]').value!==vars.categoryId||one('filters[facility]').value!==vars.facilityId||one('filters[date]').value!==vars.targetDate)fail('DATE_MISMATCH','官网当前的项目、设施或日期与任务不一致');
    const checked=named('selection[timeslot_wrapper][timeslots]').filter(e=>e.checked&&!e.disabled);
    if(checked.length!==1||checked[0].value!==vars.slot.id)fail('DATE_MISMATCH','官网当前所选时段与任务不一致');
    return true;
  }
  function review(vars){
    guard();selection(vars);
    const d=dialog(),form=d?.querySelector('form.fbs-booking-confirmation-form');
    if(!form)fail('PAGE_CHANGED','官网没有显示预订确认表单，停止提交');
    const field=label=>{const labels=[...form.querySelectorAll('label')].filter(e=>norm(e.innerText)===label);if(labels.length!==1)fail('PAGE_CHANGED',`确认页缺少 ${label}`);return norm(labels[0].parentElement.querySelector('[data-drupal-selector="edit-value"]')?.innerText);};
    const details={facility:field('Facility'),location:field('Location'),date:field('Date'),time:field('Time')};
    const time=details.time.match(/^(\d{2}:\d{2})\s*[-–]\s*(\d{2}:\d{2})$/);
    if(details.facility!==norm(vars.facilityName)||details.location!==norm(vars.location)||details.date!==vars.targetDate||!time||time[1]!==vars.slot.id||vars.slot.endTime&&time[2]!==vars.slot.endTime)fail('DATE_MISMATCH','官网确认弹窗的设施、位置、日期或时间与任务不一致');
    const u=new URL(form.action,location.href);
    if(u.origin!==location.origin||!u.pathname.startsWith('/book/'))fail('PAGE_CHANGED','官网确认表单地址发生变化');
    if([...form.querySelectorAll('input,select,textarea')].some(e=>!['hidden','submit'].includes(e.type)&&e.required))fail('MANUAL_ACTION_REQUIRED','官网确认页出现额外必填项目，请手动处理');
    const buttons=[...d.querySelectorAll('.ui-dialog-buttonpane button.modal-confirm')].filter(e=>visible(e)&&norm(e.innerText)==='Confirm'&&!e.disabled);
    if(buttons.length!==1)fail('PAGE_CHANGED','最终确认按钮已变化');
    return details;
  }
  async function prepare(vars){
    await search(vars);
    const slot=named('selection[timeslot_wrapper][timeslots]').find(e=>e.value===vars.slot.id);
    if(!slot)fail('SLOT_UNAVAILABLE','官网没有目标时段');
    if(slot.disabled)fail('SLOT_UNAVAILABLE','目标时段已满或暂未开放');
    const label=[...(slot.labels||[])].find(visible);
    if(label)label.click();else if(visible(slot))slot.click();else fail('PAGE_CHANGED','官网时段控件已变化');
    await settled();selection(vars);
    const reserve=named('op').filter(e=>visible(e)&&e.value==='Reserve'&&!e.disabled);
    if(reserve.length!==1)fail('PAGE_CHANGED','官网缺少打开预订确认页的 Reserve 按钮');
    uiClick(reserve[0]);await settled(()=>!!dialog());
    const details=review(vars);prepared=JSON.stringify(vars);return {ok:true,details};
  }
  async function submit(vars){
    if(prepared!==JSON.stringify(vars))fail('DATE_MISMATCH','本页未完成该规则的预订前检查');
    const details=review(vars);prepared=null;
    dialog().querySelector('.ui-dialog-buttonpane button.modal-confirm').click();
    await settled();return {ok:true,details};
  }
  function records(vars){
    guard();
    const tables=all('table').filter(e=>visible(e)&&[...e.querySelectorAll('th')].map(x=>norm(x.innerText)).join('|')==='Facility Type|Facility|Location|Date|Time|Action');
    if(tables.length!==1)fail('PAGE_CHANGED','官方预订记录表结构已变化，无法确认重复预订');
    for(const name of ['filters[facility_type]','filters[facility]','filters[location]','filters[date]']){
      if(named(name).some(e=>e.value&&!['_none','All'].includes(e.value)))fail('PAGE_CHANGED','官方记录页带有筛选，无法完整核对');
    }
    if(all('.pager a,[rel="next"]').some(visible))fail('MANUAL_ACTION_REQUIRED','官方记录有多页，需要完整核对后再执行');
    const rows=[...tables[0].querySelectorAll('tbody tr')];
    if(rows.length===1&&norm(rows[0].innerText)==="You've no upcoming bookings.")return [];
    const found=[];
    for(const row of rows){
      const c=[...row.querySelectorAll('td')].map(x=>norm(x.innerText));
      if(c.length!==6)fail('PAGE_CHANGED','官方预订记录行结构发生变化');
      if(c[1]!==norm(vars.facilityName)||c[2]!==norm(vars.location))continue;
      // Date rendering on nonempty records has not yet been observed: accept explicit full dates only.
      const dates=[vars.targetDate,vars.targetDate.split('-').reverse().join('/'),vars.targetDate.replaceAll('-','/')];
      if(!dates.includes(c[3])){if(/\d/.test(c[3])&&!/^\d{4}-\d{2}-\d{2}$|^\d{2}\/\d{2}\/\d{4}$|^\d{4}\/\d{2}\/\d{2}$/.test(c[3]))fail('PAGE_CHANGED','官方记录日期格式需要重新适配');continue;}
      const time=c[4].match(/^(\d{2}:\d{2})\s*[-–]\s*(\d{2}:\d{2})$/);
      if(!time)fail('PAGE_CHANGED','官方记录时间格式需要重新适配');
      if(time[1]===vars.slot.id){
        const link=[...row.querySelectorAll('a[href]')].map(a=>new URL(a.href).pathname.match(/^\/bookings\/([\w-]+)(?:\/|$)/)?.[1]).find(Boolean);
        found.push({confirmationNumber:link||'',confirmationInfo:c.slice(0,5).join(' · '),time:c[4]});
      }
    }
    return found;
  }
  return {authenticate,catalog,prepare,submit,review,records};
};
