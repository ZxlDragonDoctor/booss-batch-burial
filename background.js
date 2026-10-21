// The service worker owns all task mutations; content scripts never write counters.
importScripts('daily.js', 'storage.js');
let queue = Promise.resolve();
function serial(action) {
  const result = queue.then(action);
  queue = result.catch(error => console.error('[BossHelper]', error));
  return result;
}
const bossUrls = ['https://www.zhipin.com/*', 'https://zhipin.com/*'];
async function log(text, level = 'info') {
  const { popupLogs = [] } = await chrome.storage.local.get({ popupLogs: [] });
  await chrome.storage.local.set({ popupLogs: [...popupLogs.slice(-199), {
    time: new Date().toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai' }), text, level
  }] });
  chrome.runtime.sendMessage({ type: 'POPUP_LOG', text, level }).catch(() => {});
}
function notify(title, message) {
  chrome.notifications.create({ type: 'basic', iconUrl: 'icons/icon48.png', title, message }).catch(() => {});
}
async function stopTab(state) {
  if (state.ownerTabId != null) {
    await chrome.tabs.sendMessage(state.ownerTabId, {type:'STOP_BATCH', runId:state.runId}).catch(() => {});
  }
}
async function finish(reason, paused = false) {
  const state = await Storage.getState();
  const {records={}} = await chrome.storage.local.get({records:{}});
  for (const record of Object.values(records)) {
    if (record.runId === state.runId && record.status === 'pending') {
      record.status = 'unknown'; record.updatedAt = Date.now();
    }
  }
  await chrome.storage.local.set({records});
  await Storage.updateState({ isRunning:false, pausedOnCaptcha:paused,
    pauseReason:paused ? reason : '', lastResult:reason, lastFinishedAt:Date.now() });
  await stopTab(state);
  await log(reason, paused ? 'warn' : 'info');
  notify(paused ? '任务需要处理' : '本次沟通结束', `${reason}；今日已确认沟通 ${state.todayCount} 次`);
}
function owns(state, message, sender) {
  return state.runId && message.runId === state.runId && sender.tab?.id === state.ownerTabId;
}
async function dispatch(tabId, runId) {
  // A new tab will announce READY once its content script is installed.
  try {
    const reply = await chrome.tabs.sendMessage(tabId, {type:'START_BATCH', runId});
    return reply?.status === 'ok';
  } catch { return false; }
}
async function start(resume = false) {
  const state = await Storage.initToday();
  const config = await Storage.getConfig();
  if (state.isRunning) return {ok:false, reason:'任务已运行'};
  if (state.pausedOnCaptcha && !resume) return {ok:false, reason:'请先处理暂停原因，再手动继续'};
  if (!config.keywords?.length) throw new Error('请先配置职位关键词');
  if (state.todayCount >= config.dailyLimit) return {ok:false, reason:'已达今日沟通上限'};
  const url = new URL(config.searchUrl);
  if (url.protocol !== 'https:' || !['www.zhipin.com','zhipin.com'].includes(url.hostname) || !url.pathname.startsWith('/web/geek/job')) {
    throw new Error('搜索入口必须是 BOSS 职位列表 HTTPS 地址');
  }
  if (!url.searchParams.get('query')) url.searchParams.set('query', config.keywords[0]);
  const tabs = await chrome.tabs.query({url:bossUrls});
  let tab = tabs.find(t => t.active && /\/web\/geek\/jobs?/.test(t.url || '')) ||
    tabs.find(t => /\/web\/geek\/jobs?/.test(t.url || ''));
  if (!tab) tab = await chrome.tabs.create({url:url.href, active:true});
  const runId = crypto.randomUUID();
  await Storage.updateState({isRunning:true, pausedOnCaptcha:false, pauseReason:'', runId,
    ownerTabId:tab.id, lastRunDate:Daily.dayKey(), startedAt:Date.now(), heartbeatAt:Date.now(),
    lastResult:'等待职位页面就绪'});
  await dispatch(tab.id, runId);
  await log('任务已启动，等待页面扫描');
  return {ok:true, runId};
}
async function route(message, sender) {
  if (message.type === 'GET_STATE') return Storage.initToday();
  if (message.type === 'GET_CONFIG') return Storage.getConfig();
  // Only extension pages may issue manual control commands.
  const extensionPage = !sender.tab || sender.url?.startsWith(chrome.runtime.getURL(''));
  if (['START','STOP','RESUME'].includes(message.type) && extensionPage) {
    if (message.type === 'STOP') { await finish('用户停止'); return {ok:true}; }
    return start(message.type === 'RESUME');
  }
  const state = await Storage.initToday();
  if (message.type === 'READY') {
    if (state.isRunning && state.ownerTabId === sender.tab?.id) {
      const {records={}} = await chrome.storage.local.get({records:{}});
      if (Object.values(records).some(r => r.status === 'pending')) {
        await finish('页面中断时存在未确认发送，请核查记录后继续', true);
      } else await dispatch(state.ownerTabId, state.runId);
    }
    return {ok:true};
  }
  if (!owns(state,message,sender)) return {ok:false,reason:'非当前任务'};
  if (message.type === 'HEARTBEAT') {
    if (!state.isRunning) return {ok:false};
    await Storage.updateState({heartbeatAt:Date.now()});
    return {ok:true};
  }
  if (['PAUSE','CAPTCHA_DETECTED'].includes(message.type)) {
    await finish(message.reason || '请手动完成验证码', true); return {ok:true};
  }
  if (message.type === 'FINISH') {
    if (state.isRunning) await finish(message.reason || '没有更多匹配职位');
    return {ok:true};
  }
  if (message.type === 'RESERVE_JOB') {
    const config = await Storage.getConfig();
    if (!state.isRunning || state.todayCount >= config.dailyLimit) return {ok:false,reason:'任务停止或额度用完'};
    const job = message.job;
    if (!job || typeof job.key !== 'string' || !job.key || job.key.length > 500) return {ok:false};
    const {records={}} = await chrome.storage.local.get({records:{}});
    if (Object.hasOwn(records,job.key)) return {ok:false,reason:'此岗位已有记录'};
    records[job.key] = {key:job.key, title:String(job.title || '').slice(0,100),
      company:String(job.company || '').slice(0,100), status:'pending', runId:state.runId, updatedAt:Date.now()};
    await chrome.storage.local.set({records});
    return {ok:true};
  }
  if (message.type === 'JOB_RESULT') {
    const {records={}} = await chrome.storage.local.get({records:{}});
    const record = records[message.key];
    if (!record || record.runId !== state.runId || record.status !== 'pending') return {ok:false};
    record.status = message.status === 'confirmed' ? 'confirmed' : 'unknown';
    record.updatedAt = Date.now();
    // Save the ledger and counters in a single storage operation.
    if (record.status === 'confirmed') {
      state.todayCount++;state.communicatedCount++;state.totalAllTime++;
      state.lastResult = `已确认沟通：${record.title} @ ${record.company}`;
    }
    await chrome.storage.local.set({records,state});
    if (record.status === 'unknown') await finish('发送结果未确认，请核查沟通记录后手动继续',true);
    else if (state.todayCount >= (await Storage.getConfig()).dailyLimit) await finish('已达今日沟通上限');
    return {ok:true};
  }
  if (message.type === 'SKIP_JOB') {
    await Storage.updateState({skippedCount:state.skippedCount+1});return {ok:true};
  }
  return {ok:false};
}
chrome.runtime.onMessage.addListener((message,sender,respond) => {
  if (message.type === 'POPUP_LOG' || message.type === 'CONTENT_LOG') {
    if (sender.tab) launch(() => log(String(message.text).slice(0,2000),message.level));
    return false;
  }
  serial(() => route(message,sender)).then(respond, async error => {
    await serial(() => finish(`运行失败：${error.message}`,true)).catch(console.error);
    respond({ok:false,reason:error.message});
  });
  return true;
});
async function schedule(checkDue = true) {
  const config=await Storage.getConfig();
  await chrome.alarms.clear('dailyReset');
  if (!config.scheduleEnabled) { await chrome.alarms.clear('dailyApply'); return; }
  await chrome.alarms.create('dailyApply',{when:Daily.nextRun(config.scheduleTime)});
  const state=await Storage.initToday();
  if (!config.keywords?.length) return;
  if (checkDue && Daily.shouldRun(config,state)) {
    await Storage.updateState({lastScheduledDate:Daily.dayKey()});
    await start();
  }
}
async function watchdog() {
  const state=await Storage.getState();
  if (state.isRunning && Date.now() - (state.heartbeatAt || state.startedAt || 0) > 120000) {
    await finish('页面超过两分钟无响应，请检查后手动继续',true);
  }
}
function launch(action) {
  serial(action).catch(error => serial(() => finish(`调度失败：${error.message}`,true)).catch(console.error));
}
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === 'dailyApply') launch(() => schedule(true));
  if (alarm.name === 'taskWatchdog') launch(watchdog);
});
chrome.storage.onChanged.addListener((changes,area) => {
  if (area === 'sync' && changes.config) launch(() => schedule(true));
});
chrome.tabs.onRemoved.addListener(tabId => launch(async () => {
  const state=await Storage.getState();
  if (state.isRunning && state.ownerTabId === tabId) await finish('任务页面已关闭，请手动继续',true);
}));
chrome.runtime.onStartup.addListener(() => launch(async () => {
  const state=await Storage.getState();
  if (state.isRunning) await finish('浏览器重启中断任务，请核查记录后继续',true);
  await schedule(true);
}));
chrome.runtime.onInstalled.addListener(() => launch(() => schedule(true)));
// Recreate alarms every time the MV3 worker wakes, without resetting an active task.
launch(async () => {
  await chrome.alarms.create('taskWatchdog',{periodInMinutes:1});
  await watchdog();
  await schedule(true);
});
