// popup.js - 快速控制面板逻辑 (v2.0 增强版)
document.addEventListener('DOMContentLoaded', async () => {
  try {
    await refreshUI();
    loadLogs();
  } catch (e) {
    console.error('[BossHelper] Popup init error:', e);
  }

  // Only the background worker mutates task state.
  document.getElementById('toggleBtn').addEventListener('click', async () => {
    const button = document.getElementById('toggleBtn');
    button.disabled = true;
    try {
      const state = await chrome.runtime.sendMessage({type:'GET_STATE'});
      const type = state.pausedOnCaptcha ? 'RESUME' : state.isRunning ? 'STOP' : 'START';
      const result = await chrome.runtime.sendMessage({type});
      if (!result?.ok) addLog(result?.reason || '操作未完成', 'warn');
      await refreshUI();
    } catch (error) { addLog(error.message,'error'); }
    finally { button.disabled = false; }
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.state) refreshUI();
  });

  // 打开配置页
  document.getElementById('openOptionsBtn').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  // 打开 BOSS 直聘
  document.getElementById('openZhipinBtn').addEventListener('click', async () => {
    try {
      const config = await Storage.getConfig();
      const url = config.searchUrl || 'https://www.zhipin.com/web/geek/jobs';
      chrome.tabs.create({ url });
    } catch (e) {
      chrome.tabs.create({ url: 'https://www.zhipin.com/web/geek/jobs' });
    }
  });

  // 诊断按钮
  document.getElementById('debugBtn').addEventListener('click', async () => {
    addLog('🔍 开始全面诊断...', 'info');

    try {
      // 1. 检查配置
      const config = await Storage.getConfig();
      const kw = config.keywords || [];
      const msg = config.greetingMessages || [];
      addLog(`📋 关键词: ${kw.length ? kw.join(', ') : '⚠️ 未设置!'}`, kw.length ? 'info' : 'error');
      addLog(`📋 话术: ${msg.length} 条`, msg.length ? 'info' : 'warn');
      addLog(`📋 日限额: ${config.dailyLimit} | 间隔: ${config.intervalMin}-${config.intervalMax}s`, 'info');

      // 2. 检查状态
      const state = await Storage.getState();
      addLog(`📋 今日投递: ${state.todayCount}/${config.dailyLimit}`, 'info');
      addLog(`📋 累计投递: ${state.totalAllTime}`, 'info');

      // 3. 连接状态检查
      const pingStart = Date.now();
      try {
        const pong = await chrome.runtime.sendMessage({ type: 'GET_STATE' });
        const latency = Date.now() - pingStart;
        addLog(`✅ Service Worker 响应正常 (${latency}ms)`, 'success');
      } catch (e) {
        addLog(`⚠️ Service Worker 通信延迟 (${Date.now() - pingStart}ms)`, 'warn');
      }

      // 4. 检查 BOSS 页面
      const tabs = await chrome.tabs.query({
        url: ['https://www.zhipin.com/*', 'https://zhipin.com/*']
      });

      if (tabs.length === 0) {
        addLog('❌ 未检测到 BOSS 直聘页面', 'error');
        addLog('💡 点击"🌐 BOSS"按钮打开 BOSS 直聘', 'info');
      } else {
        addLog(`✅ ${tabs.length} 个 BOSS 直聘页面`, 'success');
        for (const tab of tabs) {
          addLog(`  📄 Tab#${tab.id}: ${tab.url?.substring(0, 60) || '?'} ${tab.active ? '(当前)' : ''}`, 'info');
          try {
            const pong = await chrome.tabs.sendMessage(tab.id, { type: 'PING' });
            if (pong && pong.status === 'ok') {
              addLog(`  ✅ Content script 正常 (运行中: ${pong.running || false})`, 'success');
            }

            // DOM 诊断
            addLog(`  📋 获取 DOM 诊断...`, 'info');
            const diag = await chrome.tabs.sendMessage(tab.id, { type: 'DIAGNOSE' });
            if (diag) {
              addLog(`  📊 登录状态: ${diag.isLoggedIn ? '已登录' : '未登录'} | 职位页: ${diag.isOnJobList ? '是' : '否'}`, diag.isLoggedIn ? 'info' : 'error');
              addLog(`  📊 卡片匹配: ${diag.cardsFound}`, diag.cardsFound > 0 ? 'info' : 'warn');
              if (diag.firstCardHTML) {
                addLog(`  📄 首卡 HTML(前600): ${diag.firstCardHTML.substring(0, 600)}`, 'info');
              }
              if (diag.greetButtons && diag.greetButtons.length) {
                addLog(`  📊 按钮: ${diag.greetButtons.map(b => `"${b.text}"`).join(', ')}`, 'info');
              }
              if (diag.dialogs && diag.dialogs.length) {
                diag.dialogs.forEach((d, i) => {
                  addLog(`  💬 弹窗#${i+1}: ${d.text.substring(0, 50)}`, 'warn');
                });
              }
            }
          } catch (e) {
            addLog(`  ❌ Tab#${tab.id} content script 无响应`, 'error');
            addLog(`  💡 请刷新该页面后重试`, 'info');
          }
        }
      }
    } catch (e) {
      addLog(`❌ 诊断出错: ${e.message}`, 'error');
    }

    addLog('🔍 诊断完成', 'info');
  });

  // 清空日志
  document.getElementById('clearLogBtn').addEventListener('click', () => {
    document.getElementById('logContent').innerHTML = '';
    chrome.storage.local.set({ popupLogs: [] });
  });

  // 监听日志消息
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'POPUP_LOG') {
      addLog(msg.text, msg.level || 'info');
    }
  });
});

// ============================================================
// 日志系统
// ============================================================
function addLog(text, level = 'info') {
  const logContent = document.getElementById('logContent');
  if (!logContent) return;

  const line = document.createElement('div');
  line.className = 'log-line ' + level;
  const time = new Date().toLocaleTimeString();
  line.textContent = `[${time}] ${text}`;
  logContent.appendChild(line);
  logContent.scrollTop = logContent.scrollHeight;

  const logBox = document.getElementById('logBox');
  if (logBox) logBox.style.display = 'block';

  // Execution logs are persisted by the background worker, even while the popup is closed.
}

function saveLogToStorage(log) {
  chrome.storage.local.get({ popupLogs: [] }, (result) => {
    const logs = result.popupLogs.slice(-49);
    logs.push(log);
    chrome.storage.local.set({ popupLogs: logs });
  });
}

function loadLogs() {
  chrome.storage.local.get({ popupLogs: [] }, (result) => {
    const logs = result.popupLogs;
    if (logs.length) {
      const logBox = document.getElementById('logBox');
      if (logBox) logBox.style.display = 'block';
      const logContent = document.getElementById('logContent');
      if (!logContent) return;
      logs.forEach(log => {
        const line = document.createElement('div');
        line.className = 'log-line ' + (log.level || 'info');
        line.textContent = `[${log.time}] ${log.text}`;
        logContent.appendChild(line);
      });
      logContent.scrollTop = logContent.scrollHeight;
    }
  });
}

// ============================================================
// 刷新所有 UI 状态
// ============================================================
async function refreshUI() {
  try {
    const state = await Storage.getState();
    const config = await Storage.getConfig();

    const indicator = document.getElementById('statusIndicator');
    const statusText = document.getElementById('statusText');
    const toggleBtn = document.getElementById('toggleBtn');

    if (!indicator || !statusText || !toggleBtn) return;

    if (state.pausedOnCaptcha) {
      indicator.className = 'status-dot paused';
      statusText.textContent = state.pauseReason || '任务已暂停';
      toggleBtn.className = 'toggle-btn start';
      toggleBtn.textContent = '▶ 继续投递';
    } else if (state.isRunning) {
      indicator.className = 'status-dot running';
      statusText.textContent = '● 运行中';
      toggleBtn.className = 'toggle-btn stop';
      toggleBtn.textContent = '⏹ 停止';
    } else {
      indicator.className = 'status-dot stopped';
      statusText.textContent = state.lastResult || '已停止';
      toggleBtn.className = 'toggle-btn start';
      toggleBtn.textContent = '▶ 开始海投';
    }

    document.getElementById('todayCount').textContent = state.todayCount;
    document.getElementById('communicatedCount').textContent = state.communicatedCount;
    document.getElementById('skippedCount').textContent = state.skippedCount;
    document.getElementById('totalAllTime').textContent = state.totalAllTime;

    const limit = config.dailyLimit || 100;
    const pct = Math.min(100, (state.todayCount / limit) * 100);
    const fill = document.getElementById('progressFill');
    if (fill) fill.style.width = pct + '%';
    const display = document.getElementById('dailyLimitDisplay');
    if (display) display.textContent = limit;
  } catch (e) {
    console.error('[BossHelper] refreshUI error:', e);
  }
}
