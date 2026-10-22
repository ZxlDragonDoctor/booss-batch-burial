const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
function harness() {
  const db = { local: {}, sync: {} }, listeners = {}, sent = [], alarms = {};
  const event = name => ({ addListener(fn) { (listeners[name] ||= []).push(fn); } });
  const area = name => ({
    async get(defaults) { return { ...structuredClone(defaults), ...structuredClone(db[name]) }; },
    async set(value) { Object.assign(db[name], structuredClone(value)); }
  });
  const chrome = {
    storage: { local: area('local'), sync: area('sync'), onChanged: event('changed') },
    runtime: { getURL: p => 'chrome-extension://test/' + p, onMessage: event('message'), onStartup: event('startup'), onInstalled: event('installed'), async sendMessage() {} },
    alarms: { async create(n,a) { alarms[n]=a; }, async clear(n) { delete alarms[n]; }, onAlarm: event('alarm') },
    notifications: { async create() {} },
    tabs: { async query() { return [{ id: 7, url: 'https://www.zhipin.com/web/geek/jobs', active: true }]; },
      async get(id) { return { id }; }, async sendMessage(id,msg) { sent.push({id,msg}); return {status:'ok'}; },
      async create() { return {id:7}; }, async update(id,data) { sent.push({id,navigate:data.url}); return {id}; }, onRemoved: event('removed') }
  };
  const ctx = vm.createContext({ chrome, console, Date, URL, setTimeout, clearTimeout, crypto: require('node:crypto').webcrypto });
  ctx.importScripts = (...paths) => paths.forEach(p => vm.runInContext(fs.readFileSync(p,'utf8'),ctx));
  vm.runInContext(fs.readFileSync('background.js','utf8'),ctx);
  return { db, ctx, sent, alarms, listeners, async message(msg, id=7, senderOverride) {
    return new Promise(resolve => { listeners.message[0](msg, senderOverride || (['START','STOP','RESUME'].includes(msg.type) ? {} : {tab:{id, url:'https://www.zhipin.com/web/geek/jobs'}}), resolve); });
  } };
}
test('后台串行计数、持久去重，拒绝非所属标签页', async () => {
  const h=harness();
  h.db.sync.config={ keywords:['Java'], scheduleEnabled:false };
  await h.message({type:'START'}, undefined);
  const state=await h.message({type:'GET_STATE'});
  const runId=state.runId;
  assert.ok(runId, '启动必须持久记录 runId');
  const job={ key:'job:123', title:'Java', company:'测试' };
  assert.equal((await h.message({type:'RESERVE_JOB',runId,job},8)).ok,false);
  assert.equal((await h.message({type:'RESERVE_JOB',runId,job})).ok,true);
  await h.message({type:'JOB_RESULT',runId,key:job.key,status:'confirmed'});
  await h.message({type:'JOB_RESULT',runId,key:job.key,status:'confirmed'});
  assert.equal((await h.message({type:'GET_STATE'})).todayCount,1);
  assert.equal((await h.message({type:'RESERVE_JOB',runId,job})).ok,false);
});
test('风控暂停不被 FINISH 或每日任务清除', async () => {
  const h=harness();h.db.sync.config={keywords:['Java'],scheduleEnabled:false};
  await h.message({type:'START'});
  const {runId}=await h.message({type:'GET_STATE'});
  await h.message({type:'PAUSE',runId,reason:'需要验证码'});
  await h.message({type:'FINISH',runId});
  assert.equal((await h.message({type:'GET_STATE'})).pausedOnCaptcha,true);
});
test('无法确认的发送保留记录并暂停，不盲目重发', async () => {
  const h=harness();h.db.sync.config={keywords:['Java'],scheduleEnabled:false};
  await h.message({type:'START'});
  const {runId}=await h.message({type:'GET_STATE'});
  await h.message({type:'RESERVE_JOB',runId,job:{key:'job:456',title:'Java'}});
  await h.message({type:'JOB_RESULT',runId,key:'job:456',status:'unknown'});
  assert.equal(h.db.local.records['job:456'].status,'unknown');
  assert.equal((await h.message({type:'GET_STATE'})).todayCount,0);
  assert.equal((await h.message({type:'GET_STATE'})).pausedOnCaptcha,true);
});
test('并发启动只启动一个任务，过期结果不能污染新任务', async () => {
  const h=harness();h.db.sync.config={keywords:['Java'],scheduleEnabled:false};
  const replies=await Promise.all([h.message({type:'START'}),h.message({type:'START'})]);
  assert.equal(replies.filter(r=>r.ok).length,1);
  const old=(await h.message({type:'GET_STATE'})).runId;
  await h.message({type:'STOP'});
  await h.message({type:'START'});
  await h.message({type:'FINISH',runId:old});
  assert.equal((await h.message({type:'GET_STATE'})).isRunning,true);
});
test('页面加载中断 pending 转为待核查，手动继续仍跳过该岗位', async () => {
  const h=harness();h.db.sync.config={keywords:['Java'],scheduleEnabled:false};
  await h.message({type:'START'});
  let {runId}=await h.message({type:'GET_STATE'});
  await h.message({type:'RESERVE_JOB',runId,job:{key:'job:pending',title:'Java'}});
  await h.message({type:'READY'});
  assert.equal(h.db.local.records['job:pending'].status,'unknown');
  assert.equal((await h.message({type:'GET_STATE'})).pausedOnCaptcha,true);
  assert.equal((await h.message({type:'RESUME'})).ok,true);
  runId=(await h.message({type:'GET_STATE'})).runId;
  assert.equal((await h.message({type:'RESERVE_JOB',runId,job:{key:'job:pending'}})).ok,false);
});
test('定时重复唤醒当天只自动启动一次', async () => {
  const h=harness();h.db.sync.config={keywords:['Java'],scheduleEnabled:true,scheduleTime:'00:00'};
  await h.message({type:'GET_STATE'});
  assert.equal(h.sent.filter(x=>x.msg.type==='START_BATCH').length,1);
  await h.message({type:'STOP'});
  h.listeners.alarm[0]({name:'dailyApply'});
  await h.message({type:'GET_STATE'});
  assert.equal(h.sent.filter(x=>x.msg.type==='START_BATCH').length,1);
});
test('作为独立标签页打开的扩展控制面板也能启动任务', async () => {
  const h=harness();h.db.sync.config={keywords:['Java'],scheduleEnabled:false};
  const reply=await h.message({type:'START'},99,{tab:{id:99},url:'chrome-extension://test/popup/popup.html'});
  assert.equal(reply.ok,true);
});
test('完整详情导航保留任务归属，READY 携带目标岗位，拒绝外部网址',async()=>{
  const h=harness();h.db.sync.config={keywords:['Java'],scheduleEnabled:false};
  await h.message({type:'START'});
  const {runId}=await h.message({type:'GET_STATE'});
  const job={key:'job:abc',id:'abc',title:'Java开发',company:'测试',href:'https://www.zhipin.com/job_detail/abc.html'};
  assert.equal((await h.message({type:'OPEN_JOB_DETAIL',runId,job:{...job,href:'https://evil.example/job_detail/abc.html'}})).ok,false);
  assert.equal((await h.message({type:'OPEN_JOB_DETAIL',runId,job})).ok,true);
  assert.equal(h.sent.at(-1).navigate,job.href);
  await h.message({type:'READY'});
  assert.equal(h.sent.at(-1).msg.activeJob.key,job.key);
  await h.message({type:'RETURN_TO_LIST',runId});
  assert.match(h.sent.at(-1).navigate,/\/web\/geek\/jobs/);
  assert.equal((await h.message({type:'GET_STATE'})).activeJob,null);
});
test('平台已沟通的岗位记为 existing，跳过而不增加成功数',async()=>{
  const h=harness();h.db.sync.config={keywords:['Java'],scheduleEnabled:false};
  await h.message({type:'START'});
  const {runId}=await h.message({type:'GET_STATE'});
  const job={key:'job:existing',title:'Java开发',company:'测试公司'};
  assert.equal((await h.message({type:'JOB_EXISTING',runId,job})).ok,true);
  assert.equal(h.db.local.records[job.key].status,'existing');
  assert.equal((await h.message({type:'GET_STATE'})).todayCount,0);
});
