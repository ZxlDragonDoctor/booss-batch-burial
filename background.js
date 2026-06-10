// background.js - Service Worker
// 负责消息中转、任务调度、统计管理和桌面通知

// 在 Service Worker 中加载 storage.js
try {
  importScripts('storage.js');
} catch (e) {
  console.error('[BossHelper] storage.js 加载失败:', e);
}

// 消息路由
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case 'START':
      handleStart();
      break;
    case 'STOP':
      handleStop();
      break;
    case 'PAUSE':
      handlePause();
      break;
    case 'RESUME':
      handleResume();
      break;
    case 'UPDATE_STATS':
      handleStatsUpdate(message.data);
      break;
    case 'CAPTCHA_DETECTED':
      handleCaptcha();
      break;
    case 'POPUP_LOG':
      // content script 发来的日志，popup 自己会接收，background 不需要处理
      break;
    case 'GET_STATE':
      Storage.getState().then(state => sendResponse(state));
      return true;
  }
});

// 发送日志到 popup
function sendLog(text, level) {
  try {
    chrome.runtime.sendMessage({ type: 'POPUP_LOG', text, level }).catch(() => {});
  } catch(e) {}
}

// 启动海投
async function handleStart() {
  sendLog('▶ 收到启动指令', 'info');
  await Storage.initToday();
  const state = await Storage.getState();
  const config = await Storage.getConfig();

  // 检查日限额
  if (state.todayCount >= config.dailyLimit) {
    await Storage.updateState({ isRunning: false });
    sendLog('⏹ 已达日限额', 'warn');
    showNotification('今日额度已用完', `今日已投递 ${state.todayCount} 次，已达上限 ${config.dailyLimit} 次`);
    return;
  }

  await Storage.updateState({ isRunning: true, pausedOnCaptcha: false });

  // 通知所有打开的 BOSS 直聘页面开始
  const tabs = await chrome.tabs.query({ url: ['https://www.zhipin.com/*', 'https://zhipin.com/*'] });
  sendLog(`📋 向 ${tabs.length} 个页面发送启动指令`, 'info');
  for (const tab of tabs) {
    try {
      await chrome.tabs.sendMessage(tab.id, { type: 'START_BATCH' });
    } catch(e) {
      sendLog(`⚠️ Tab ${tab.id} 未响应（请刷新页面）`, 'warn');
    }
  }

  // 如果没有打开的 BOSS 直聘页面，自动打开搜索页
  if (!tabs.length) {
    sendLog('🔗 没有 BOSS 直聘页面，正在打开...', 'info');
    const url = config.searchUrl || 'https://www.zhipin.com/web/geek/job';
    const tab = await chrome.tabs.create({ url });
    chrome.tabs.onUpdated.addListener(function listener(tabId, info) {
      if (tabId === tab.id && info.status === 'complete') {
        setTimeout(() => {
          chrome.tabs.sendMessage(tabId, { type: 'START_BATCH' }).catch(() => {
            sendLog('⚠️ Content Script 未响应，请刷新页面', 'error');
          });
        }, 2000);
        chrome.tabs.onUpdated.removeListener(listener);
      }
    });
  }

  if (config.showNotification) {
    showNotification('海投已启动', 'BOSS 海投助手开始自动投递职位');
  }
}

// 停止海投
async function handleStop() {
  sendLog('⏹ 收到停止指令', 'warn');
  await Storage.updateState({ isRunning: false, pausedOnCaptcha: false });

  const tabs = await chrome.tabs.query({ url: ['https://www.zhipin.com/*', 'https://zhipin.com/*'] });
  for (const tab of tabs) {
    chrome.tabs.sendMessage(tab.id, { type: 'STOP_BATCH' }).catch(() => {});
  }

  const config = await Storage.getConfig();
  if (config.showNotification) {
    showNotification('海投已停止', 'BOSS 海投助手已停止投递');
  }
}

// 暂停（通常由验证码触发）
async function handlePause() {
  sendLog('⛔ 自动暂停（验证码）', 'error');
  await Storage.updateState({ isRunning: false, pausedOnCaptcha: true });

  const tabs = await chrome.tabs.query({ url: ['https://www.zhipin.com/*', 'https://zhipin.com/*'] });
  for (const tab of tabs) {
    chrome.tabs.sendMessage(tab.id, { type: 'STOP_BATCH' }).catch(() => {});
  }
}

// 恢复（用户手动恢复）
async function handleResume() {
  sendLog('▶ 用户手动恢复', 'info');
  await Storage.updateState({ isRunning: true, pausedOnCaptcha: false });
  handleStart(); // 复用启动逻辑
}

// 更新统计数据
async function handleStatsUpdate(data) {
  const state = await Storage.getState();
  const config = await Storage.getConfig();

  state.todayCount += data.todayCount || 0;
  state.communicatedCount += data.communicatedCount || 0;
  state.skippedCount += data.skippedCount || 0;
  state.totalAllTime += data.newTotal || 0;

  await Storage.saveState(state);

  // 检查是否达到日限额
  if (state.todayCount >= config.dailyLimit) {
    sendLog('⏹ 已达日限额，自动停止', 'warn');
    await handleStop();
    showNotification('今日额度已用完', `已达日限额 ${config.dailyLimit} 次`);
  }
}

// 处理验证码检测
async function handleCaptcha() {
  sendLog('⛔ 检测到验证码，自动暂停', 'error');
  await Storage.updateState({ isRunning: false, pausedOnCaptcha: true });

  const tabs = await chrome.tabs.query({ url: ['https://www.zhipin.com/*', 'https://zhipin.com/*'] });
  for (const tab of tabs) {
    chrome.tabs.sendMessage(tab.id, { type: 'STOP_BATCH' }).catch(() => {});
  }

  showNotification('检测到验证码', 'BOSS 海投助手已自动暂停，请手动完成验证');
}

// 发送桌面通知
function showNotification(title, message) {
  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icons/icon48.png',
    title: title,
    message: message,
    priority: 2
  });
}

// 每日凌晨重置统计
chrome.alarms.create('dailyReset', { periodInMinutes: 1440 });

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'dailyReset') {
    await Storage.initToday();
  }
});

// 浏览器启动时初始化
chrome.runtime.onStartup.addListener(async () => {
  await Storage.initToday();
  // 确保启动时状态为停止
  await Storage.updateState({ isRunning: false, pausedOnCaptcha: false });
});
