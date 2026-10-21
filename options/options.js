// options.js - 配置页面逻辑 (v2.0)
document.addEventListener('DOMContentLoaded', async () => {
  let config;
  try {
    config = await Storage.getConfig();
  } catch (e) {
    console.error('[BossHelper] 加载配置失败:', e);
    config = Storage.DEFAULT_CONFIG;
  }

  // 填充表单
  document.getElementById('scheduleEnabled').checked = config.scheduleEnabled === true;
  document.getElementById('scheduleTime').value = config.scheduleTime || '09:30';
  const state = await chrome.runtime.sendMessage({ type: 'GET_STATE' });
  document.getElementById('lastResult').textContent = state.lastResult || '尚未执行任务';
  document.getElementById('exportRecords').addEventListener('click', async () => {
    const data = await chrome.storage.local.get({ records: {}, state: {} });
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], {type:'application/json'}));
    const link = document.createElement('a'); link.href = url; link.download = 'boss-communication-records.json';
    link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  document.getElementById('keywords').value = (config.keywords || []).join(', ');
  document.getElementById('excludeKeywords').value = (config.excludeKeywords || []).join(', ');
  document.getElementById('cities').value = (config.cities || []).join('\n');
  document.getElementById('salaryMin').value = config.salaryMin ?? '';
  document.getElementById('salaryMax').value = config.salaryMax ?? '';
  document.querySelectorAll('#experience-group input').forEach(el => { el.checked = (config.experience || []).includes(el.value); });
  document.getElementById('greetingMessages').value = (config.greetingMessages || []).join('\n');
  document.getElementById('useCompanyPlaceholder').checked = config.useCompanyPlaceholder !== false;
  document.getElementById('useJobPlaceholder').checked = config.useJobPlaceholder === true;
  document.getElementById('dailyLimit').value = config.dailyLimit || 80;
  document.getElementById('intervalMin').value = config.intervalMin || 18;
  document.getElementById('intervalMax').value = config.intervalMax || 35;
  document.getElementById('pauseOnCaptcha').checked = config.pauseOnCaptcha !== false;
  document.getElementById('skipCommunicated').checked = config.skipCommunicated !== false;
  document.getElementById('onlyOnline').checked = config.onlyOnline === true;
  document.getElementById('showNotification').checked = config.showNotification === true;
  document.getElementById('blacklist').value = (config.blacklist || []).join(', ');
  document.getElementById('searchUrl').value = config.searchUrl || Storage.DEFAULT_CONFIG.searchUrl;

  // 保存配置
  document.getElementById('saveBtn').addEventListener('click', async () => {
    const newConfig = {
      ...config,
      scheduleEnabled: document.getElementById('scheduleEnabled').checked,
      scheduleTime: document.getElementById('scheduleTime').value,
      keywords: splitInput(document.getElementById('keywords').value),
      excludeKeywords: splitInput(document.getElementById('excludeKeywords').value),
      cities: splitLines(document.getElementById('cities').value),
      salaryMin: document.getElementById('salaryMin').value === '' ? null : Number(document.getElementById('salaryMin').value),
      salaryMax: document.getElementById('salaryMax').value === '' ? null : Number(document.getElementById('salaryMax').value),
      experience: [...document.querySelectorAll('#experience-group input:checked')].map(el => el.value),
      greetingMessages: splitLines(document.getElementById('greetingMessages').value),
      useCompanyPlaceholder: document.getElementById('useCompanyPlaceholder').checked,
      useJobPlaceholder: document.getElementById('useJobPlaceholder').checked,
      dailyLimit: parseInt(document.getElementById('dailyLimit').value) || 80,
      intervalMin: parseInt(document.getElementById('intervalMin').value) || 18,
      intervalMax: parseInt(document.getElementById('intervalMax').value) || 35,
      pauseOnCaptcha: true,
      skipCommunicated: document.getElementById('skipCommunicated').checked,
      onlyOnline: document.getElementById('onlyOnline').checked,
      showNotification: document.getElementById('showNotification').checked,
      blacklist: splitInput(document.getElementById('blacklist').value),
      searchUrl: document.getElementById('searchUrl').value || Storage.DEFAULT_CONFIG.searchUrl,
    };

    // 验证间隔
    if (newConfig.intervalMin >= newConfig.intervalMax) {
      showSaveStatus('⚠️ 最大间隔必须大于最小间隔', 'warn');
      return;
    }

    // 验证日限额
    if (newConfig.dailyLimit < 1) {
      showSaveStatus('⚠️ 日限额至少为 1', 'warn');
      return;
    }

    // 验证话术
    if (!newConfig.greetingMessages.length) {
      showSaveStatus('⚠️ 请至少配置一条打招呼话术', 'warn');
      return;
    }

    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(newConfig.scheduleTime)) {
      showSaveStatus('请输入有效的每日执行时间', 'warn'); return;
    }
    let url;
    try { url = new URL(newConfig.searchUrl); }
    catch { showSaveStatus('搜索入口 URL 格式无效', 'warn'); return; }
    if (url.protocol !== 'https:' || !['www.zhipin.com','zhipin.com'].includes(url.hostname) || !url.pathname.startsWith('/web/geek/job')) {
      showSaveStatus('搜索入口必须为 BOSS 职位列表 HTTPS 地址', 'warn'); return;
    }
    try { await Storage.saveConfig(newConfig); config = newConfig; }
    catch (error) { showSaveStatus('保存失败：' + error.message, 'warn'); return; }
    showSaveStatus('✅ 配置已保存', 'success');
  });

  // 恢复默认
  document.getElementById('resetBtn').addEventListener('click', async () => {
    if (confirm('确定恢复所有配置到默认值？')) {
      await Storage.saveConfig(Storage.DEFAULT_CONFIG);
      location.reload();
    }
  });

  // 辅助函数
  function splitInput(str) {
    return str.split(/[,，、]/).map(s => s.trim()).filter(Boolean);
  }

  function splitLines(str) {
    return str.split('\n').map(s => s.trim()).filter(Boolean);
  }

  function showSaveStatus(msg, type) {
    const el = document.getElementById('saveStatus');
    el.textContent = msg;
    el.style.color = type === 'warn' ? '#F57C00' : '#388E3C';
    el.classList.add('show');
    setTimeout(() => el.classList.remove('show'), 3000);
  }
});
