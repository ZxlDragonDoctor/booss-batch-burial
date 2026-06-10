# BOSS 海投助手 - 实施计划

> **For agentic workers:** Use subagent-driven-development or executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** 构建一个 Manifest V3 浏览器扩展，在 BOSS 直聘上实现批量自动投递（海投），支持岗位筛选、地区过滤、自定义话术和智能节奏控制。

**Architecture:** Popup（快速控制）+ Options Page（完整配置）+ Background Service Worker（调度）+ Content Script（DOM 操作），四模块通过 Chrome Storage API 通信。

**Tech Stack:** Manifest V3, Vanilla JS, Chrome Storage API, HTML5/CSS3

**文件结构：**
```
boss-batch-burial/
├── manifest.json              # Manifest V3 配置
├── background.js              # Service Worker
├── content.js                 # Content Script
├── popup/
│   ├── popup.html
│   ├── popup.css
│   └── popup.js
├── options/
│   ├── options.html
│   ├── options.css
│   └── options.js
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── docs/
    ├── specs/
    │   └── 2026-06-09-boss-海投助手-browser-extension-design.md
    └── plans/
        └── 2026-06-09-boss-海投助手-implementation-plan.md
```

---

### Task 1: 项目脚手架 + manifest.json

**Files:**
- Create: `manifest.json`
- Create: `icons/` 目录和 SVG 图标

- [ ] **Step 1: 创建 manifest.json**

```json
{
  "manifest_version": 3,
  "name": "BOSS 海投助手",
  "version": "1.0.0",
  "description": "批量自动投递BOSS直聘职位，支持岗位筛选、地区过滤、自定义打招呼",
  "permissions": [
    "storage",
    "notifications",
    "alarms"
  ],
  "host_permissions": [
    "https://www.zhipin.com/*",
    "https://zhipin.com/*"
  ],
  "action": {
    "default_popup": "popup/popup.html",
    "default_icon": {
      "16": "icons/icon16.png",
      "48": "icons/icon48.png",
      "128": "icons/icon128.png"
    },
    "default_title": "BOSS 海投助手"
  },
  "options_page": "options/options.html",
  "background": {
    "service_worker": "background.js"
  },
  "content_scripts": [
    {
      "matches": ["https://www.zhipin.com/*", "https://zhipin.com/*"],
      "js": ["content.js"],
      "run_at": "document_idle"
    }
  ],
  "icons": {
    "16": "icons/icon16.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png"
  }
}
```

- [ ] **Step 2: 生成 SVG 图标并导出为 PNG**

创建 icons/ 目录。使用以下命令生成 SVG 图标文件，然后转换为 PNG（或在无法转换时直接使用 SVG）：

```bash
mkdir -p icons popup options
```

创建 `icons/icon.svg`：

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
  <rect width="128" height="128" rx="24" fill="#00A5A5"/>
  <text x="64" y="82" font-size="72" font-weight="bold" text-anchor="middle" fill="white">B</text>
  <text x="64" y="120" font-size="24" font-weight="bold" text-anchor="middle" fill="white" opacity="0.8">海投</text>
</svg>
```

由于无法直接生成 PNG，创建 `icons/README.md` 说明需要手动转换：

```markdown
# 图标说明

需要将 icon.svg 导出为 16x16、48x48、128x128 的 PNG 文件。
推荐工具：https://convertio.co/ 或 Chrome 扩展开发时自动生成。

在 Chrome 加载扩展时，如果 .png 缺失可以使用占位图标。
```

---

### Task 2: 存储层（Storage Utils）

**Files:**
- Create: `storage.js` — Chrome Storage 封装模块（被 popup、options、background、content 共用）

**逻辑：** 将 chrome.storage 的异步 get/set 封装为 Promise 接口，提供配置和状态的默认值。

- [ ] **Step 1: 编写 storage.js**

```javascript
// storage.js - Chrome Storage 封装
const Storage = {
  // 默认配置
  DEFAULT_CONFIG: {
    keywords: [],
    excludeKeywords: [],
    cities: [],
    salaryMin: null,
    salaryMax: null,
    experience: [],
    greetingMessages: [
      "您好，我对该职位很感兴趣，方便看看我的简历吗？"
    ],
    useCompanyPlaceholder: true,
    useJobPlaceholder: false,
    dailyLimit: 100,
    intervalMin: 5,
    intervalMax: 12,
    pauseOnCaptcha: true,
    skipCommunicated: true,
    onlyOnline: false,
    blacklist: [],
    searchUrl: "https://www.zhipin.com/web/geek/job?query="
  },

  // 默认状态
  DEFAULT_STATE: {
    isRunning: false,
    todayDate: "",
    todayCount: 0,
    communicatedCount: 0,
    skippedCount: 0,
    totalAllTime: 0,
    lastRunDate: "",
    pausedOnCaptcha: false
  },

  // 获取配置
  async getConfig() {
    const result = await chrome.storage.sync.get({ config: this.DEFAULT_CONFIG });
    return { ...this.DEFAULT_CONFIG, ...result.config };
  },

  // 保存配置
  async saveConfig(config) {
    await chrome.storage.sync.set({ config });
  },

  // 获取状态
  async getState() {
    const result = await chrome.storage.local.get({ state: this.DEFAULT_STATE });
    return { ...this.DEFAULT_STATE, ...result.state };
  },

  // 保存状态
  async saveState(state) {
    await chrome.storage.local.set({ state });
  },

  // 更新部分状态
  async updateState(partial) {
    const state = await this.getState();
    Object.assign(state, partial);
    await this.saveState(state);
    return state;
  },

  // 初始化今天的数据（如果日期变更则重置）
  async initToday() {
    const today = new Date().toISOString().split('T')[0];
    const state = await this.getState();
    if (state.todayDate !== today) {
      state.todayDate = today;
      state.todayCount = 0;
      state.communicatedCount = 0;
      state.skippedCount = 0;
      await this.saveState(state);
    }
    return state;
  },

  // 监听配置变化
  onConfigChange(callback) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'sync' && changes.config) {
        callback(changes.config.newValue);
      }
    });
  }
};
```

- [ ] **Step 2: 验证语法正确性**

```bash
# 确保 storage.js 没有语法错误
node -e "const fs = require('fs'); const code = fs.readFileSync('storage.js','utf8'); try { new Function(code); console.log('OK'); } catch(e) { console.error(e.message); }"
```

---

### Task 3: Options Page（配置页面）

**Files:**
- Create: `options/options.html`
- Create: `options/options.css`
- Create: `options/options.js`

- [ ] **Step 1: 编写 options/options.html**

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>BOSS 海投助手 - 配置</title>
  <link rel="stylesheet" href="options.css">
</head>
<body>
  <div class="container">
    <header>
      <h1>🚀 BOSS 海投助手</h1>
      <p class="subtitle">配置你的自动投递参数</p>
    </header>

    <section id="section-filter">
      <h2>🔍 岗位筛选</h2>
      <div class="form-group">
        <label for="keywords">关键词（多个用逗号隔开）</label>
        <input type="text" id="keywords" placeholder="Java, Python, 后端开发">
      </div>
      <div class="form-group">
        <label for="excludeKeywords">排除关键词</label>
        <input type="text" id="excludeKeywords" placeholder="实习, 校招, 外包">
      </div>
      <div class="form-group">
        <label for="cities">地区（每行一个）</label>
        <textarea id="cities" rows="3" placeholder="北京&#10;上海&#10;深圳"></textarea>
      </div>
      <div class="form-row">
        <div class="form-group half">
          <label for="salaryMin">最低薪资（月薪/K）</label>
          <input type="number" id="salaryMin" placeholder="15" min="0">
        </div>
        <div class="form-group half">
          <label for="salaryMax">最高薪资（月薪/K）</label>
          <input type="number" id="salaryMax" placeholder="不限" min="0">
        </div>
      </div>
      <div class="form-group">
        <label>工作经验要求</label>
        <div class="checkbox-group" id="experience">
          <label><input type="checkbox" value="不限"> 不限</label>
          <label><input type="checkbox" value="1年以下"> 1年以下</label>
          <label><input type="checkbox" value="1-3年"> 1-3年</label>
          <label><input type="checkbox" value="3-5年"> 3-5年</label>
          <label><input type="checkbox" value="5-10年"> 5-10年</label>
          <label><input type="checkbox" value="10年以上"> 10年+</label>
        </div>
      </div>
    </section>

    <section id="section-greeting">
      <h2>💬 打招呼设置</h2>
      <div class="form-group">
        <label>话术列表（每行一条，随机选用）</label>
        <textarea id="greetingMessages" rows="4"
          placeholder="您好，我对该职位很感兴趣，方便看看我的简历吗？"></textarea>
      </div>
      <div class="checkbox-group">
        <label><input type="checkbox" id="useCompanyPlaceholder"> 添加公司名称占位符 <code>{公司名}</code></label>
        <label><input type="checkbox" id="useJobPlaceholder"> 添加职位名称占位符 <code>{职位名}</code></label>
      </div>
    </section>

    <section id="section-rhythm">
      <h2>⏱ 投递节奏控制</h2>
      <div class="form-row">
        <div class="form-group half">
          <label for="dailyLimit">每日投递上限（次）</label>
          <input type="number" id="dailyLimit" value="100" min="1" max="500">
        </div>
        <div class="form-group half">
          <label>&nbsp;</label>
          <div>&nbsp;</div>
        </div>
      </div>
      <div class="form-row">
        <div class="form-group half">
          <label for="intervalMin">最小间隔（秒）</label>
          <input type="number" id="intervalMin" value="5" min="3" max="60">
        </div>
        <div class="form-group half">
          <label for="intervalMax">最大间隔（秒）</label>
          <input type="number" id="intervalMax" value="12" min="3" max="60">
        </div>
      </div>
      <div class="checkbox-group">
        <label><input type="checkbox" id="pauseOnCaptcha"> 遇到验证码时自动暂停</label>
      </div>
    </section>

    <section id="section-advanced">
      <h2>⚙️ 高级设置</h2>
      <div class="form-group">
        <label for="blacklist">黑名单公司（多个用逗号隔开）</label>
        <input type="text" id="blacklist" placeholder="某某科技, 某某信息">
      </div>
      <div class="checkbox-group">
        <label><input type="checkbox" id="skipCommunicated"> 跳过已沟通/已投递的职位</label>
        <label><input type="checkbox" id="onlyOnline"> 仅投递「在线」状态的 HR</label>
        <label><input type="checkbox" id="showNotification"> 投递时显示桌面通知</label>
      </div>
      <div class="form-group">
        <label for="searchUrl">搜索入口 URL</label>
        <input type="url" id="searchUrl" placeholder="https://www.zhipin.com/web/geek/job?query=">
      </div>
    </section>

    <div class="actions">
      <button id="saveBtn" class="btn-primary">💾 保存配置</button>
      <button id="resetBtn" class="btn-secondary">↺ 恢复默认</button>
      <span id="saveStatus" class="save-status"></span>
    </div>
  </div>
  <script src="../storage.js"></script>
  <script src="options.js"></script>
</body>
</html>
```

- [ ] **Step 2: 编写 options/options.css**

```css
* { margin: 0; padding: 0; box-sizing: border-box; }
body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  background: #f5f7fa;
  color: #333;
  padding: 20px;
}
.container { max-width: 720px; margin: 0 auto; }
header { margin-bottom: 24px; }
header h1 { font-size: 28px; color: #00A5A5; }
.subtitle { color: #888; font-size: 14px; margin-top: 4px; }

section {
  background: #fff;
  border-radius: 12px;
  padding: 20px 24px;
  margin-bottom: 16px;
  box-shadow: 0 1px 4px rgba(0,0,0,0.06);
}
section h2 { font-size: 18px; margin-bottom: 16px; color: #222; }

.form-group { margin-bottom: 14px; }
.form-group label {
  display: block;
  font-size: 14px;
  font-weight: 500;
  margin-bottom: 6px;
  color: #444;
}
.form-group input[type="text"],
.form-group input[type="number"],
.form-group input[type="url"],
.form-group textarea {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid #ddd;
  border-radius: 8px;
  font-size: 14px;
  transition: border-color 0.2s;
}
.form-group input:focus,
.form-group textarea:focus {
  outline: none;
  border-color: #00A5A5;
  box-shadow: 0 0 0 3px rgba(0,165,165,0.1);
}
.form-row { display: flex; gap: 12px; }
.form-group.half { flex: 1; }

.checkbox-group { display: flex; flex-wrap: wrap; gap: 10px 20px; margin-top: 6px; }
.checkbox-group label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
  cursor: pointer;
}
.checkbox-group input[type="checkbox"] { width: 16px; height: 16px; cursor: pointer; }
.checkbox-group code {
  background: #f0f0f0;
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 12px;
}

.actions {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 20px;
}
.btn-primary {
  background: #00A5A5;
  color: #fff;
  border: none;
  padding: 12px 32px;
  border-radius: 8px;
  font-size: 16px;
  cursor: pointer;
  transition: background 0.2s;
}
.btn-primary:hover { background: #008a8a; }
.btn-secondary {
  background: #eee;
  color: #666;
  border: none;
  padding: 12px 24px;
  border-radius: 8px;
  font-size: 14px;
  cursor: pointer;
}
.btn-secondary:hover { background: #ddd; }
.save-status {
  font-size: 14px;
  color: #00A5A5;
  opacity: 0;
  transition: opacity 0.3s;
}
.save-status.show { opacity: 1; }
```

- [ ] **Step 3: 编写 options/options.js**

```javascript
// options.js
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
  const expCheckboxes = document.querySelectorAll('#experience input[type="checkbox"]');
  expCheckboxes.forEach(cb => {
    cb.checked = config.experience.includes(cb.value);
  });

  // 保存
  document.getElementById('saveBtn').addEventListener('click', async () => {
    const expValues = [];
    expCheckboxes.forEach(cb => { if (cb.checked) expValues.push(cb.value); });

    const newConfig = {
      keywords: document.getElementById('keywords').value.split(/[,，]/).map(s => s.trim()).filter(Boolean),
      excludeKeywords: document.getElementById('excludeKeywords').value.split(/[,，]/).map(s => s.trim()).filter(Boolean),
      cities: document.getElementById('cities').value.split('\n').map(s => s.trim()).filter(Boolean),
      salaryMin: parseInt(document.getElementById('salaryMin').value) || null,
      salaryMax: parseInt(document.getElementById('salaryMax').value) || null,
      experience: expValues,
      greetingMessages: document.getElementById('greetingMessages').value.split('\n').map(s => s.trim()).filter(Boolean),
      useCompanyPlaceholder: document.getElementById('useCompanyPlaceholder').checked,
      useJobPlaceholder: document.getElementById('useJobPlaceholder').checked,
      dailyLimit: parseInt(document.getElementById('dailyLimit').value) || 100,
      intervalMin: parseInt(document.getElementById('intervalMin').value) || 5,
      intervalMax: parseInt(document.getElementById('intervalMax').value) || 12,
      pauseOnCaptcha: document.getElementById('pauseOnCaptcha').checked,
      blacklist: document.getElementById('blacklist').value.split(/[,，]/).map(s => s.trim()).filter(Boolean),
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

  function showSaveStatus(msg) {
    const el = document.getElementById('saveStatus');
    el.textContent = msg;
    el.classList.add('show');
    setTimeout(() => el.classList.remove('show'), 3000);
  }
});
```

---

### Task 4: Popup（快速控制面板）

**Files:**
- Create: `popup/popup.html`
- Create: `popup/popup.css`
- Create: `popup/popup.js`

- [ ] **Step 1: 编写 popup/popup.html**

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>BOSS 海投助手</title>
  <link rel="stylesheet" href="popup.css">
</head>
<body>
  <div class="popup-container">
    <div class="header">
      <h1>🚀 BOSS 海投助手</h1>
    </div>

    <div class="status-bar">
      <span id="statusIndicator" class="status-dot stopped"></span>
      <span id="statusText" class="status-text">已停止</span>
    </div>

    <button id="toggleBtn" class="toggle-btn start">▶ 开始海投</button>

    <div class="stats">
      <div class="stat-item">
        <span class="stat-label">今日投递</span>
        <span class="stat-value" id="todayCount">0</span>
      </div>
      <div class="stat-item">
        <span class="stat-label">已沟通</span>
        <span class="stat-value" id="communicatedCount">0</span>
      </div>
      <div class="stat-item">
        <span class="stat-label">已跳过</span>
        <span class="stat-value" id="skippedCount">0</span>
      </div>
      <div class="stat-item">
        <span class="stat-label">累计</span>
        <span class="stat-value" id="totalAllTime">0</span>
      </div>
    </div>

    <div class="progress-bar">
      <div class="progress-fill" id="progressFill"></div>
    </div>
    <div class="progress-text">
      日限额: <span id="dailyLimitDisplay">100</span> 次
    </div>

    <div class="footer">
      <button id="openOptionsBtn" class="footer-btn">⚙️ 打开配置</button>
      <button id="openZhipinBtn" class="footer-btn">🌐 打开 BOSS 直聘</button>
    </div>
  </div>
  <script src="../storage.js"></script>
  <script src="popup.js"></script>
</body>
</html>
```

- [ ] **Step 2: 编写 popup/popup.css**

```css
* { margin: 0; padding: 0; box-sizing: border-box; }
body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  background: #fff;
  color: #333;
  width: 320px;
}
.popup-container { padding: 16px; }

.header { text-align: center; margin-bottom: 12px; }
.header h1 { font-size: 18px; color: #00A5A5; }

.status-bar {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  margin-bottom: 12px;
}
.status-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  display: inline-block;
}
.status-dot.running { background: #4CAF50; box-shadow: 0 0 6px rgba(76,175,80,0.5); }
.status-dot.stopped { background: #bbb; }
.status-dot.paused { background: #FF9800; }
.status-text { font-size: 14px; color: #666; }

.toggle-btn {
  width: 100%;
  padding: 12px;
  border: none;
  border-radius: 10px;
  font-size: 16px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
  margin-bottom: 16px;
}
.toggle-btn.start { background: #4CAF50; color: #fff; }
.toggle-btn.start:hover { background: #43a047; }
.toggle-btn.stop { background: #f44336; color: #fff; }
.toggle-btn.stop:hover { background: #e53935; }

.stats {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr 1fr;
  gap: 8px;
  margin-bottom: 12px;
}
.stat-item {
  text-align: center;
  background: #f5f7fa;
  border-radius: 8px;
  padding: 10px 4px;
}
.stat-label { display: block; font-size: 11px; color: #888; margin-bottom: 4px; }
.stat-value { display: block; font-size: 20px; font-weight: 700; color: #333; }

.progress-bar {
  height: 6px;
  background: #eee;
  border-radius: 3px;
  margin-bottom: 4px;
  overflow: hidden;
}
.progress-fill {
  height: 100%;
  background: #00A5A5;
  border-radius: 3px;
  transition: width 0.3s;
  width: 0%;
}
.progress-text { font-size: 11px; color: #888; text-align: right; margin-bottom: 16px; }

.footer { display: flex; gap: 8px; }
.footer-btn {
  flex: 1;
  padding: 8px;
  border: 1px solid #ddd;
  border-radius: 8px;
  background: #fff;
  font-size: 12px;
  cursor: pointer;
  transition: background 0.2s;
}
.footer-btn:hover { background: #f5f7fa; }
```

- [ ] **Step 3: 编写 popup/popup.js**

```javascript
// popup.js
document.addEventListener('DOMContentLoaded', async () => {
  await refreshUI();

  // 启动/停止
  document.getElementById('toggleBtn').addEventListener('click', async () => {
    const state = await Storage.getState();
    if (state.isRunning) {
      await Storage.updateState({ isRunning: false });
      await chrome.runtime.sendMessage({ type: 'STOP' }).catch(() => {});
    } else {
      const config = await Storage.getConfig();
      if (!config.keywords.length) {
        alert('请先配置关键词！');
        chrome.runtime.openOptionsPage();
        return;
      }
      await Storage.updateState({ isRunning: true });
      await chrome.runtime.sendMessage({ type: 'START' }).catch(() => {});
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
    const url = config.searchUrl || 'https://www.zhipin.com/web/geek/job';
    chrome.tabs.create({ url });
  });
});

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

  // 统计
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
```

---

### Task 5: Background Service Worker

**Files:**
- Create: `background.js`

**逻辑：** 负责消息中转、控制 content script、处理每日重置、发送桌面通知。

- [ ] **Step 1: 编写 background.js**

```javascript
// background.js - Service Worker
try { importScripts('storage.js'); } catch(e) { console.error('storage.js load failed:', e); }

// 监听来自 popup 或 content script 的消息
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
    case 'GET_STATE':
      Storage.getState().then(state => sendResponse(state));
      return true; // 保持消息通道打开
  }
});

async function handleStart() {
  await Storage.initToday();
  const state = await Storage.getState();
  const config = await Storage.getConfig();

  // 检查日限额
  if (state.todayCount >= config.dailyLimit) {
    await Storage.updateState({ isRunning: false });
    showNotification('今日额度已用完', `今日已投递 ${state.todayCount} 次，已达上限 ${config.dailyLimit} 次`);
    return;
  }

  await Storage.updateState({ isRunning: true, pausedOnCaptcha: false });

  // 通知 content script 开始
  const tabs = await chrome.tabs.query({ url: ['https://www.zhipin.com/*', 'https://zhipin.com/*'] });
  for (const tab of tabs) {
    chrome.tabs.sendMessage(tab.id, { type: 'START_BATCH' }).catch(() => {});
  }

  // 如果没有打开的 BOSS 直聘页面，自动打开
  if (!tabs.length) {
    const tab = await chrome.tabs.create({ url: config.searchUrl || 'https://www.zhipin.com/web/geek/job' });
    // 等待页面加载后 content script 会自动收到 START_BATCH
    chrome.tabs.onUpdated.addListener(function listener(tabId, info) {
      if (tabId === tab.id && info.status === 'complete') {
        chrome.tabs.sendMessage(tabId, { type: 'START_BATCH' }).catch(() => {});
        chrome.tabs.onUpdated.removeListener(listener);
      }
    });
  }

  showNotification('海投已启动', 'BOSS 海投助手开始自动投递');
}

async function handleStop() {
  await Storage.updateState({ isRunning: false, pausedOnCaptcha: false });
  const tabs = await chrome.tabs.query({ url: ['https://www.zhipin.com/*', 'https://zhipin.com/*'] });
  for (const tab of tabs) {
    chrome.tabs.sendMessage(tab.id, { type: 'STOP_BATCH' }).catch(() => {});
  }
  showNotification('海投已停止', 'BOSS 海投助手已停止');
}

async function handlePause() {
  await Storage.updateState({ isRunning: false, pausedOnCaptcha: true });
  const tabs = await chrome.tabs.query({ url: ['https://www.zhipin.com/*', 'https://zhipin.com/*'] });
  for (const tab of tabs) {
    chrome.tabs.sendMessage(tab.id, { type: 'STOP_BATCH' }).catch(() => {});
  }
}

async function handleResume() {
  await Storage.updateState({ isRunning: true, pausedOnCaptcha: false });
  handleStart(); // 复用启动逻辑
}

async function handleStatsUpdate(data) {
  const state = await Storage.getState();
  const config = await Storage.getConfig();
  state.todayCount += data.todayCount || 0;
  state.communicatedCount += data.communicatedCount || 0;
  state.skippedCount += data.skippedCount || 0;
  if (data.newTotal) state.totalAllTime += data.newTotal || 0;
  await Storage.saveState(state);

  // 检查日限额
  if (state.todayCount >= config.dailyLimit) {
    await handleStop();
    showNotification('今日额度已用完', `已达日限额 ${config.dailyLimit} 次`);
  }
}

async function handleCaptcha() {
  await Storage.updateState({ isRunning: false, pausedOnCaptcha: true });
  const tabs = await chrome.tabs.query({ url: ['https://www.zhipin.com/*', 'https://zhipin.com/*'] });
  for (const tab of tabs) {
    chrome.tabs.sendMessage(tab.id, { type: 'STOP_BATCH' }).catch(() => {});
  }
  showNotification('检测到验证码', 'BOSS 海投助手已自动暂停，请手动验证');
}

function showNotification(title, message) {
  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icons/icon48.png',
    title,
    message,
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
```

---

### Task 6: Content Script（核心）

**Files:**
- Create: `content.js`

**逻辑：** 注入 BOSS 直聘页面，扫描职位列表、筛选、自动打招呼、翻页。

- [ ] **Step 1: 编写 content.js**

```javascript
// content.js - BOSS 直聘页面操作脚本
(function() {
  'use strict';

  let isRunning = false;
  let isProcessing = false;
  let currentJobIndex = 0;
  let jobQueue = [];
  let stopRequested = false;

  // 监听来自 background 的消息
  chrome.runtime.onMessage.addListener((message) => {
    switch (message.type) {
      case 'START_BATCH':
        isRunning = true;
        stopRequested = false;
        startBatch();
        break;
      case 'STOP_BATCH':
        isRunning = false;
        stopRequested = true;
        break;
    }
  });

  // 辅助睡眠函数
  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // 获取随机间隔（配置范围内）
  async function getRandomDelay() {
    try {
      const config = await Storage.getConfig();
      const min = (config.intervalMin || 5) * 1000;
      const max = (config.intervalMax || 12) * 1000;
      return Math.floor(Math.random() * (max - min + 1)) + min;
    } catch {
      return 8000;
    }
  }

  // 主流程
  async function startBatch() {
    if (isProcessing) return;
    isProcessing = true;

    try {
      while (isRunning && !stopRequested) {
        // 1. 扫描当前页职位
        const jobs = scanJobList();
        if (!jobs.length) {
          console.log('[BossHelper] 当前页没有找到职位');
          if (!await tryNextPage()) break;
          continue;
        }

        // 2. 筛选
        const config = await Storage.getConfig();
        jobQueue = jobs.filter(job => filterJob(job, config));
        console.log(`[BossHelper] 筛选后: ${jobQueue.length}/${jobs.length} 个职位`);

        if (!jobQueue.length) {
          if (!await tryNextPage()) break;
          continue;
        }

        // 3. 逐个处理
        for (const job of jobQueue) {
          if (!isRunning || stopRequested) break;

          // 检查日限额
          const state = await Storage.getState();
          if (state.todayCount >= config.dailyLimit) {
            console.log('[BossHelper] 已达日限额');
            chrome.runtime.sendMessage({ type: 'STOP' }).catch(() => {});
            isRunning = false;
            break;
          }

          await processJob(job, config);
          await sleep(await getRandomDelay());
        }

        // 4. 翻到下一页
        if (isRunning && !stopRequested) {
          if (!await tryNextPage()) break;
        }
      }
    } catch (err) {
      console.error('[BossHelper] 运行错误:', err);
    }

    isProcessing = false;
  }

  // 扫描当前页职位列表
  function scanJobList() {
    const jobs = [];
    // BOSS 直聘的职位卡片选择器 - 需要根据实际页面调整
    const cards = document.querySelectorAll('.job-card-wrapper, [class*="job-card"], .job-list li');
    if (!cards.length) {
      // 备用：尝试找到所有包含职位标题的容器
      const altCards = document.querySelectorAll('.job-primary, .job-info, [class*="job-item"]');
      cards.length = 0;
      cards.push(...altCards);
    }

    cards.forEach((card, index) => {
      const titleEl = card.querySelector('.job-name, [class*="job-title"], .job-title, a[class*="name"]');
      const areaEl = card.querySelector('.job-area, [class*="job-area"], [class*="city"], .city');
      const salaryEl = card.querySelector('.salary, [class*="salary"], .red, [class*="pay"]');
      const companyEl = card.querySelector('.company-name, [class*="company"], a[class*="company"]');
      const statusEl = card.querySelector('.job-status, [class*="status"], .already-communicated, .already-chat');

      const title = titleEl ? titleEl.textContent.trim() : '';
      const area = areaEl ? areaEl.textContent.trim() : '';
      const salary = salaryEl ? salaryEl.textContent.trim() : '';
      const company = companyEl ? companyEl.textContent.trim() : '';
      const isCommunicated = statusEl && (
        statusEl.textContent.includes('已沟通') ||
        statusEl.textContent.includes('已投递') ||
        statusEl.textContent.includes('已回复')
      );

      // 提取经验要求
      const expItems = card.querySelectorAll('.job-limit .experience, [class*="experience"], .job-detail .exp');
      const experience = Array.from(expItems).map(el => el.textContent.trim()).filter(Boolean).join(' ');

      jobs.push({
        index,
        title,
        area,
        salary,
        company,
        experience,
        isCommunicated,
        element: card,
        clickable: titleEl || card.querySelector('a')
      });
    });

    return jobs;
  }

  // 筛选职位
  function filterJob(job, config) {
    const title = job.title.toLowerCase();

    // 关键词匹配（必须至少命中一个）
    if (config.keywords && config.keywords.length) {
      const match = config.keywords.some(kw => title.includes(kw.toLowerCase()));
      if (!match) return false;
    }

    // 排除关键词
    if (config.excludeKeywords && config.excludeKeywords.length) {
      const excluded = config.excludeKeywords.some(kw => title.includes(kw.toLowerCase()));
      if (excluded) return false;
    }

    // 地区筛选
    if (config.cities && config.cities.length) {
      const matchArea = config.cities.some(city => job.area.includes(city));
      if (!matchArea) return false;
    }

    // 经验筛选
    if (config.experience && config.experience.length) {
      const matchExp = config.experience.some(exp => job.experience.includes(exp));
      if (!matchExp) return false;
    }

    // 跳过已沟通
    if (config.skipCommunicated && job.isCommunicated) return false;

    // 黑名单
    if (config.blacklist && config.blacklist.length) {
      const blocked = config.blacklist.some(b => job.company.includes(b));
      if (blocked) return false;
    }

    return true;
  }

  // 处理单个职位（点击+打招呼）
  async function processJob(job, config) {
    console.log(`[BossHelper] 处理: ${job.title} @ ${job.company}`);

    try {
      // 点击职位卡片
      if (job.clickable) {
        job.clickable.click();
      } else {
        job.element.click();
      }

      // 等待右侧详情面板加载
      await sleep(2000);

      // 查找打招呼按钮
      const chatBtn = findChatButton();
      if (!chatBtn) {
        console.log('[BossHelper] 未找到打招呼按钮，可能已沟通');
        chrome.runtime.sendMessage({
          type: 'UPDATE_STATS',
          data: { skippedCount: 1 }
        }).catch(() => {});
        return;
      }

      // 点击打招呼
      chatBtn.click();
      await sleep(1500);

      // 检查是否有弹窗需要填写打招呼内容
      const dialogInput = document.querySelector('.chat-input textarea, [class*="dialog"] textarea, .greeting-textarea');
      if (dialogInput) {
        const message = await buildGreetingMessage(job, config);
        dialogInput.value = message;
        dialogInput.dispatchEvent(new Event('input', { bubbles: true }));
        await sleep(500);

        // 点击发送按钮
        const sendBtn = document.querySelector('.chat-send-btn, [class*="send"], .btn-send, button:contains("发送")');
        if (sendBtn) {
          sendBtn.click();
        } else {
          // 尝试回车发送
          dialogInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', which: 13, keyCode: 13 }));
        }
        await sleep(1500);
      }

      // 检查验证码
      if (isCaptchaVisible()) {
        chrome.runtime.sendMessage({ type: 'CAPTCHA_DETECTED' }).catch(() => {});
        isRunning = false;
        return;
      }

      // 报告成功
      chrome.runtime.sendMessage({
        type: 'UPDATE_STATS',
        data: { todayCount: 1, communicatedCount: 1, newTotal: 1 }
      }).catch(() => {});

      console.log(`[BossHelper] ✅ ${job.title} @ ${job.company}`);

    } catch (err) {
      console.error(`[BossHelper] 处理失败: ${job.title}`, err);
      chrome.runtime.sendMessage({
        type: 'UPDATE_STATS',
        data: { skippedCount: 1 }
      }).catch(() => {});
    }
  }

  // 查找打招呼按钮
  function findChatButton() {
    // BOSS 直聘的打招呼按钮选择器
    const selectors = [
      '.btn-chat',
      '.chat-btn',
      '[class*="chat"] button',
      '[class*="greet"]',
      'a[class*="chat"]',
      '.btn-startchat',
      'button:contains("打招呼")',
      'a:contains("打招呼")',
      '.btn:contains("沟通")',
      'button:contains("沟通")'
    ];

    for (const selector of selectors) {
      const el = document.querySelector(selector);
      if (el && el.offsetParent !== null) return el; // 可见
    }

    return null;
  }

  // 构建打招呼消息
  async function buildGreetingMessage(job, config) {
    let messages = config.greetingMessages || ['您好，我对该职位很感兴趣，方便看看我的简历吗？'];
    let message = messages[Math.floor(Math.random() * messages.length)];

    if (config.useCompanyPlaceholder) {
      message = message.replace(/\{公司名\}/g, job.company);
    }
    if (config.useJobPlaceholder) {
      message = message.replace(/\{职位名\}/g, job.title);
    }

    return message;
  }

  // 检查验证码
  function isCaptchaVisible() {
    const captchaSelectors = [
      '.captcha',
      '#captcha',
      '[class*="captcha"]',
      '.nc-container',
      '.slider-container',
      '.verify-container',
      'iframe[src*="captcha"]',
      'iframe[src*="verify"]',
      '[class*="verify"]'
    ];
    return captchaSelectors.some(sel => {
      const el = document.querySelector(sel);
      return el && el.offsetParent !== null;
    });
  }

  // 翻页
  async function tryNextPage() {
    const nextBtn = document.querySelector('.next, .page-next, [class*="next"], a:contains("下一页"), button:contains("下一页")');
    if (!nextBtn || nextBtn.disabled || nextBtn.classList.contains('disabled')) {
      console.log('[BossHelper] 没有更多页了');
      return false;
    }

    console.log('[BossHelper] 翻到下一页');
    nextBtn.click();
    await sleep(3000); // 等待新页加载
    return true;
  }

  // 监听页面变化（SPA 翻页后重新扫描）
  const observer = new MutationObserver((mutations) => {
    if (isRunning && !isProcessing) {
      // 检测到 DOM 变化，可能是翻页了
      startBatch();
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true
  });

  console.log('[BossHelper] Content Script 已加载');
})();
```

---

### Task 7: 集成验证

**Files:** 无需修改文件

- [ ] **Step 1: Chrome 加载扩展**

在 Chrome 中打开 `chrome://extensions`，开启"开发者模式"，点击"加载已解压的扩展"，选择项目根目录 `D:\idea_java_project\booss-batch-burial`。

- [ ] **Step 2: 验证扩展加载成功**
  - 确认扩展图标出现在工具栏
  - 确认没有显示任何错误

- [ ] **Step 3: 打开 Options Page**
  - 右键扩展图标 → "选项"
  - 验证所有表单字段加载正常
  - 填写测试关键词"Java"
  - 点击保存，刷新确认数据持久化

- [ ] **Step 4: 打开 Popup**
  - 点击扩展图标
  - 验证统计数据显示正常
  - 点击"打开 BOSS 直聘"确认跳转

- [ ] **Step 5: 打开 BOSS 直聘搜索页并验证 Content Script**
  - 打开 `https://www.zhipin.com/web/geek/job?query=Java`
  - 打开 DevTools Console 确认 `[BossHelper] Content Script 已加载` 输出
  - 如果在登录状态，在配置页配置好关键词后，回到 popup 点击"开始海投"
  - 观察控制台日志，确认扫描、筛选、点击流程执行

---

### 清单总览

| 任务 | 状态 | 文件 |
|------|------|------|
| Task 1: 脚手架 + manifest | pending | `manifest.json`, `icons/*` |
| Task 2: 存储层 | pending | `storage.js` |
| Task 3: Options Page | pending | `options/options.html`, `.css`, `.js` |
| Task 4: Popup | pending | `popup/popup.html`, `.css`, `.js` |
| Task 5: Background SW | pending | `background.js` |
| Task 6: Content Script | pending | `content.js` |
| Task 7: 集成验证 | pending | - |
