// popup.js - 快速控制面板逻辑
document.addEventListener('DOMContentLoaded', async () => {
  await refreshUI();
  loadLogs();

  // 启动/停止按钮
  document.getElementById('toggleBtn').addEventListener('click', async () => {
    const state = await Storage.getState();

    if (state.isRunning) {
      await Storage.updateState({ isRunning: false });
      await chrome.runtime.sendMessage({ type: 'STOP' }).catch(() => {});
      addLog('已停止海投', 'warn');
    } else {
      const config = await Storage.getConfig();
      if (!config.keywords || !config.keywords.length) {
        alert('请先配置关键词！');
        chrome.runtime.openOptionsPage();
        return;
      }
      await Storage.updateState({ isRunning: true });
      await chrome.runtime.sendMessage({ type: 'START' }).catch(() => {});
      addLog('▶ 启动海投...', 'info');
    }
    await refreshUI();
  });

  // 打开配置页
  document.getElementById('openOptionsBtn').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  // 打开 BOSS 直聘
  document.getElementById('openZhipinBtn').addEventListener('click', async () => {
    const config = await Storage.getConfig();
    const url = config.searchUrl || 'https://www.zhipin.com/web/geek/jobs';
    chrome.tabs.create({ url });
  });

  // 诊断按钮
  document.getElementById('debugBtn').addEventListener('click', async () => {
    addLog('🔍 开始诊断...', 'info');

    // 1. 检查配置
    const config = await Storage.getConfig();
    addLog(`配置: 关键词[${(config.keywords||[]).join(',')||'未设置!'}] 日限额[${config.dailyLimit}]`, config.keywords.length ? 'info' : 'error');

    // 2. 检查状态
    const state = await Storage.getState();
    addLog(`状态: 今日投递[${state.todayCount}] 运行中[${state.isRunning}]`, 'info');

    // 3. 检查 BOSS 直聘页面
    const tabs = await chrome.tabs.query({ url: ['https://www.zhipin.com/*', 'https://zhipin.com/*'] });
    if (tabs.length === 0) {
      addLog('❌ 未检测到 BOSS 直聘页面', 'error');
    } else {
      addLog(`✅ ${tabs.length} 个 BOSS 直聘页面`, 'success');
      for (const tab of tabs) {
        try {
          // PING 检测
          const pong = await chrome.tabs.sendMessage(tab.id, { type: 'PING' });
          addLog(`✅ Tab[${tab.id}] content script OK`, 'success');

          // 调用 DOM 诊断
          addLog(`📋 正在获取 Tab[${tab.id}] DOM 诊断...`, 'info');
          try {
            const diag = await chrome.tabs.sendMessage(tab.id, { type: 'DIAGNOSE' });
            if (diag) {
              addLog(`📊 卡片选择器匹配: ${diag.cardsFound} 个 (最佳: ${diag.bestSelector || '无'})`, 'info');
              addLog(`📊 对话框/弹窗: ${(diag.dialogs||[]).length} 个`, 'info');
              if (diag.dialogs && diag.dialogs.length > 0) {
                diag.dialogs.forEach((d, i) => {
                  addLog(`  弹窗#${i+1}: 类别="${d.classes.substring(0,60)}" 文本="${d.text.substring(0,50)}"`, 'warn');
                });
              }
              addLog(`📊 textarea: ${diag.textareas} 个`, 'info');
              addLog(`📊 详情面板: ${diag.detailPanels} 个`, 'info');
              addLog(`📊 问候按钮: ${(diag.greetButtons||[]).length} 个`, 'info');
              if (diag.greetButtons && diag.greetButtons.length > 0) {
                diag.greetButtons.forEach((b, i) => {
                  addLog(`  按钮#${i+1}: "${b.text}"`, 'info');
                });
              }
              addLog(`📊 body cursor: ${diag.bodyCursor || 'normal'}`, 'info');
              if (diag.sampleClasses) {
                addLog(`📊 卡片示例类名: ${diag.sampleClasses}`, 'info');
              }
            }
          } catch(e) {
            addLog(`⚠️ DOM 诊断失败: ${e.message}`, 'warn');
          }
        } catch (e) {
          addLog(`❌ Tab[${tab.id}] content script 无响应，请刷新页面`, 'error');
        }
      }
    }

    addLog('🔍 诊断完成', 'info');
  });

  // 清空日志
  document.getElementById('clearLogBtn').addEventListener('click', () => {
    document.getElementById('logContent').innerHTML = '';
    chrome.storage.local.set({ popupLogs: [] });
  });

  // 监听来自 background/content 的日志
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
  const line = document.createElement('div');
  line.className = 'log-line ' + level;
  const time = new Date().toLocaleTimeString();
  line.textContent = `[${time}] ${text}`;
  logContent.appendChild(line);
  logContent.scrollTop = logContent.scrollHeight;

  // 显示日志框
  document.getElementById('logBox').style.display = 'block';

  // 保存到 storage
  saveLogToStorage({ time, text, level });
}

function saveLogToStorage(log) {
  chrome.storage.local.get({ popupLogs: [] }, (result) => {
    const logs = result.popupLogs.slice(-49); // 最多保存 50 条
    logs.push(log);
    chrome.storage.local.set({ popupLogs: logs });
  });
}

function loadLogs() {
  chrome.storage.local.get({ popupLogs: [] }, (result) => {
    const logs = result.popupLogs;
    if (logs.length) {
      document.getElementById('logBox').style.display = 'block';
      const logContent = document.getElementById('logContent');
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
  const state = await Storage.getState();
  const config = await Storage.getConfig();

  // 状态指示
  const indicator = document.getElementById('statusIndicator');
  const statusText = document.getElementById('statusText');
  const toggleBtn = document.getElementById('toggleBtn');

  if (state.pausedOnCaptcha) {
    indicator.className = 'status-dot paused';
    statusText.textContent = '⛔ 遇验证码已暂停';
    toggleBtn.className = 'toggle-btn start';
    toggleBtn.textContent = '▶ 继续投递';
  } else if (state.isRunning) {
    indicator.className = 'status-dot running';
    statusText.textContent = '● 运行中';
    toggleBtn.className = 'toggle-btn stop';
    toggleBtn.textContent = '⏹ 停止';
  } else {
    indicator.className = 'status-dot stopped';
    statusText.textContent = '已停止';
    toggleBtn.className = 'toggle-btn start';
    toggleBtn.textContent = '▶ 开始海投';
  }

  // 统计数据
  document.getElementById('todayCount').textContent = state.todayCount;
  document.getElementById('communicatedCount').textContent = state.communicatedCount;
  document.getElementById('skippedCount').textContent = state.skippedCount;
  document.getElementById('totalAllTime').textContent = state.totalAllTime;

  // 进度条
  const limit = config.dailyLimit || 100;
  const pct = Math.min(100, (state.todayCount / limit) * 100);
  document.getElementById('progressFill').style.width = pct + '%';
  document.getElementById('dailyLimitDisplay').textContent = limit;
}
