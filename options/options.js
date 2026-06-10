// options.js - 配置页面逻辑
document.addEventListener('DOMContentLoaded', async () => {
  const config = await Storage.getConfig();

  // 加载配置到表单
  document.getElementById('keywords').value = (config.keywords || []).join(', ');
  document.getElementById('excludeKeywords').value = (config.excludeKeywords || []).join(', ');
  document.getElementById('cities').value = (config.cities || []).join('\n');
  document.getElementById('salaryMin').value = config.salaryMin || '';
  document.getElementById('salaryMax').value = config.salaryMax || '';
  document.getElementById('greetingMessages').value = (config.greetingMessages || []).join('\n');
  document.getElementById('useCompanyPlaceholder').checked = config.useCompanyPlaceholder;
  document.getElementById('useJobPlaceholder').checked = config.useJobPlaceholder;
  document.getElementById('dailyLimit').value = config.dailyLimit;
  document.getElementById('intervalMin').value = config.intervalMin;
  document.getElementById('intervalMax').value = config.intervalMax;
  document.getElementById('pauseOnCaptcha').checked = config.pauseOnCaptcha;
  document.getElementById('blacklist').value = (config.blacklist || []).join(', ');
  document.getElementById('skipCommunicated').checked = config.skipCommunicated;
  document.getElementById('onlyOnline').checked = config.onlyOnline;
  document.getElementById('showNotification').checked = config.showNotification || false;
  document.getElementById('searchUrl').value = config.searchUrl;

  // 工作经验复选框
  const expCheckboxes = document.querySelectorAll('#experience-group input[type="checkbox"]');
  expCheckboxes.forEach(cb => {
    cb.checked = config.experience.includes(cb.value);
  });

  // 保存配置
  document.getElementById('saveBtn').addEventListener('click', async () => {
    const expValues = [];
    expCheckboxes.forEach(cb => { if (cb.checked) expValues.push(cb.value); });

    const newConfig = {
      keywords: splitInput(document.getElementById('keywords').value),
      excludeKeywords: splitInput(document.getElementById('excludeKeywords').value),
      cities: splitLines(document.getElementById('cities').value),
      salaryMin: parseInt(document.getElementById('salaryMin').value) || null,
      salaryMax: parseInt(document.getElementById('salaryMax').value) || null,
      experience: expValues,
      greetingMessages: splitLines(document.getElementById('greetingMessages').value),
      useCompanyPlaceholder: document.getElementById('useCompanyPlaceholder').checked,
      useJobPlaceholder: document.getElementById('useJobPlaceholder').checked,
      dailyLimit: parseInt(document.getElementById('dailyLimit').value) || 100,
      intervalMin: parseInt(document.getElementById('intervalMin').value) || 5,
      intervalMax: parseInt(document.getElementById('intervalMax').value) || 12,
      pauseOnCaptcha: document.getElementById('pauseOnCaptcha').checked,
      blacklist: splitInput(document.getElementById('blacklist').value),
      skipCommunicated: document.getElementById('skipCommunicated').checked,
      onlyOnline: document.getElementById('onlyOnline').checked,
      showNotification: document.getElementById('showNotification').checked,
      searchUrl: document.getElementById('searchUrl').value || Storage.DEFAULT_CONFIG.searchUrl
    };

    await Storage.saveConfig(newConfig);
    showSaveStatus('✅ 配置已保存');
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

  function showSaveStatus(msg) {
    const el = document.getElementById('saveStatus');
    el.textContent = msg;
    el.classList.add('show');
    setTimeout(() => el.classList.remove('show'), 3000);
  }
});
