export const DEFAULT_RULE = {
  facilityId: '', facilityName: '', category: '', categoryId:'', location:'', dateMode: 'relative_7_days', targetDate: '',
  weekday: 5, startDate: '', endDate: '', intervalWeeks: 1, offsetDays: 7,
  timezone: 'Asia/Hong_Kong', openingTime: '08:00:00', precheckSeconds: 30,
  slots: [], fallbackSlots: [], attemptMode: 'first_success', enabled: true, mode: 'dry_run',
  userType: 'student_staff_alumni', maxLateSeconds: 45
};
export const DEFAULT_PROFILE = {
  version: 'hkust_recorded_v1', entryUrl: 'https://fbs.hkust.edu.hk/facilities',
  dateFormat: 'YYYY-MM-DD', steps: [], authenticated: null, success: null,
  confirmationNumber: null, records: {url: '', rows: null, steps: []},
  identity: '', verified: false
};
export const NATIVE_PROFILE={...DEFAULT_PROFILE,version:'hkust_drupal_v1',identity:'local-browser-user',accountHash:'',authenticated:{tag:'a',attrs:{href:'/user/logout'}},records:{url:'https://fbs.hkust.edu.hk/bookings',rows:null,steps:[]}};
export class FlowError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
export function dayParts(instant, timezone = 'Asia/Hong_Kong') {
  const fmt = new Intl.DateTimeFormat('en-CA', {timeZone: timezone, year:'numeric', month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
  return Object.fromEntries(fmt.formatToParts(new Date(instant)).filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));
}
export function localDay(instant = Date.now(), timezone = 'Asia/Hong_Kong') {
  const p = dayParts(instant, timezone); return `${p.year}-${p.month}-${p.day}`;
}
export function validDay(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`); return Number.isFinite(+d) && d.toISOString().slice(0,10) === value;
}
export function addDays(day, days) {
  if (!validDay(day)) throw new FlowError('INVALID_DATE', '无效日期');
  const d = new Date(`${day}T00:00:00Z`); d.setUTCDate(d.getUTCDate()+Number(days)); return d.toISOString().slice(0,10);
}
export function weekday(day) { return (new Date(`${day}T00:00:00Z`).getUTCDay()+6)%7; }
export function dateFor(rule, executionDay, scheduled = false) {
  if (rule.dateMode==='fixed_date') {
    if (!validDay(rule.targetDate)) throw new FlowError('INVALID_DATE','请选择有效固定日期');
    return scheduled && addDays(rule.targetDate,-rule.offsetDays)!==executionDay ? null : rule.targetDate;
  }
  const target = addDays(executionDay, rule.offsetDays);
  if (rule.dateMode==='recurring') {
    if (weekday(target)!==Number(rule.weekday)) return null;
    if (rule.startDate && target<rule.startDate || rule.endDate && target>rule.endDate) return null;
    if (rule.startDate) {
      const elapsed = Math.floor((Date.parse(target)-Date.parse(rule.startDate))/86400000/7);
      if (elapsed % Number(rule.intervalWeeks || 1)) return null;
    }
  }
  return target;
}
// Resolve a wall-clock time in an IANA timezone. A nonexistent DST time returns null.
export function zonedTime(day, clock, timezone) {
  const values = clock.split(':').map(Number); while(values.length<3) values.push(0);
  const desired = `${day}T${values.map(v=>String(v).padStart(2,'0')).join(':')}`;
  const wanted = Date.parse(desired+'Z'); let guess = wanted;
  for (let i=0;i<4;i++) {
    const p=dayParts(guess,timezone); const actual=Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`);
    const shift=wanted-actual; if (!shift) return guess; guess+=shift;
  }
  return null;
}
export function nextPlan(rule, now=Date.now()) {
  let day=localDay(now,rule.timezone);
  for(let i=0;i<740;i++,day=addDays(day,1)) {
    const target=dateFor(rule,day,true); if(!target) continue;
    const submitAt=zonedTime(day,rule.openingTime,rule.timezone);
    if(submitAt===null || submitAt<=now) continue;
    return {executionDay:day,targetDate:target,submitAt,precheckAt:submitAt-rule.precheckSeconds*1000};
  }
  return null;
}
export function formatDate(day, format='YYYY-MM-DD') {
  const [y,m,d]=day.split('-');
  const months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return format.replace('YYYY',y).replace('MMM',months[Number(m)-1]).replace('MM',m).replace('DD',d);
}
export function keyFor(identity,rule,date,slot) { return [identity,rule.facilityId,date,slot.id].map(encodeURIComponent).join('|'); }
export function validateRule(rule) {
  if(!rule.facilityId.trim() || !rule.facilityName.trim()) throw new FlowError('CONFIG_REQUIRED','请选择扫描得到的设施，或填写官方稳定 ID 与名称');
  if(!rule.slots.length || rule.slots.some(x=>!x.id.trim()||!x.label.trim())) throw new FlowError('CONFIG_REQUIRED','至少填写一个包含官方 ID 和名称的目标时段');
  if(!['relative_7_days','fixed_date','recurring'].includes(rule.dateMode)) throw new FlowError('CONFIG_REQUIRED','日期模式无效');
  if(!['dry_run','prepare','auto'].includes(rule.mode)) throw new FlowError('CONFIG_REQUIRED','执行模式无效');
  if(!['first_success','all'].includes(rule.attemptMode)) throw new FlowError('CONFIG_REQUIRED','尝试策略无效');
  if(!/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(rule.openingTime)) throw new FlowError('CONFIG_REQUIRED','开放时间无效');
  if(!Number.isInteger(rule.offsetDays)||rule.offsetDays<0||rule.offsetDays>365) throw new FlowError('CONFIG_REQUIRED','提前天数应为 0–365');
  if(!Number.isInteger(rule.weekday)||rule.weekday<0||rule.weekday>6) throw new FlowError('CONFIG_REQUIRED','星期无效');
  if(!Number.isInteger(rule.intervalWeeks)||rule.intervalWeeks<1||rule.intervalWeeks>52) throw new FlowError('CONFIG_REQUIRED','重复间隔应为 1–52 周');
  if(rule.precheckSeconds<5||rule.precheckSeconds>3600) throw new FlowError('CONFIG_REQUIRED','预检查提前量应为 5–3600 秒');
  if(rule.startDate&&!validDay(rule.startDate)||rule.endDate&&!validDay(rule.endDate)) throw new FlowError('INVALID_DATE','重复范围日期无效');
  if(rule.startDate&&rule.endDate&&rule.startDate>rule.endDate) throw new FlowError('INVALID_DATE','开始日期不能晚于结束日期');
  new Intl.DateTimeFormat('en',{timeZone:rule.timezone});
  if(rule.dateMode==='fixed_date'&&!validDay(rule.targetDate)) throw new FlowError('INVALID_DATE','请选择固定日期');
  const ids=[...rule.slots,...rule.fallbackSlots].map(s=>s.id);
  if(new Set(ids).size!==ids.length) throw new FlowError('CONFIG_REQUIRED','目标和候补时段不能重复');
  return rule;
}
export function validateProfile(p, auto=false) {
  if(!safeUrl(p.entryUrl)) throw new FlowError('CONFIG_REQUIRED','预订入口必须是官方 FBS 地址');
  if(p.version==='hkust_drupal_v1'){
    if(p.entryUrl!=='https://fbs.hkust.edu.hk/facilities'||p.records.url!=='https://fbs.hkust.edu.hk/bookings')throw new FlowError('CONFIG_REQUIRED','原生适配器仅支持当前 HKUST 新版网站');
    return;
  }
  for(const s of [...p.steps,...p.records.steps]) {
    if(!['click','select','input','wait'].includes(s.kind)||!['prepare','submit','confirm'].includes(s.phase)||!['none','facility','date','slot'].includes(s.variable||'none')) throw new FlowError('CONFIG_REQUIRED','录制步骤参数无效');
  }
  if(!p.authenticated) throw new FlowError('CONFIG_REQUIRED','请绑定仅登录后可见的身份标记（例如退出登录按钮）');
  if(!p.steps.length) throw new FlowError('CONFIG_REQUIRED','请先录制真实预订流程');
  for(const variable of ['facility','date','slot']) if(!p.steps.some(s=>s.variable===variable)) throw new FlowError('CONFIG_REQUIRED',`录制流程缺少 ${variable} 变量`);
  if(auto) {
    if(!p.identity.trim()) throw new FlowError('CONFIG_REQUIRED','请设置本地账户标识以隔离重复预订键');
    if(!p.steps.some(s=>s.phase==='submit')) throw new FlowError('CONFIG_REQUIRED','缺少标记为提交的步骤');
    if(!p.success||!p.confirmationNumber||!p.records.url||!p.records.rows) throw new FlowError('CONFIG_REQUIRED','请绑定成功标记、确认编号和预订记录行');
    if(!safeUrl(p.records.url)) throw new FlowError('CONFIG_REQUIRED','记录页地址必须属于官方 FBS');
    if(p.records.steps.some(s=>s.phase!=='prepare'||s.variable&&s.variable!=='none')) throw new FlowError('CONFIG_REQUIRED','记录查询流程只允许只读导航');
  }
}
export function safeUrl(url) {
  try {const u=new URL(url);return u.protocol==='https:'&&(u.hostname==='fbs.hkust.edu.hk'||u.hostname==='w5.ab.ust.hk'&&u.pathname.startsWith('/fbs_user/'));}catch{return false;}
}
export function redact(message) {
  return String(message).replace(/([?&](?:ticket|token|execution|session|code|SAMLResponse)=)[^&\s]+/gi,'$1[已隐藏]').slice(0,1600);
}
export function textMatchesRow(text, rule, targetDate, slot, dateFormat) {
  const norm=v=>String(v).normalize('NFKC').replace(/\s+/g,'').toLowerCase();
  const t=norm(text); return [rule.facilityName,formatDate(targetDate,dateFormat),slot.label].every(v=>t.includes(norm(v)));
}
