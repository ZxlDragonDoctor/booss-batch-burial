// storage.js - Chrome Storage 封装 (v2.0)
// 提供配置和状态的默认值、Promise 接口、以及监听能力
const Storage = {
  // 默认配置
  DEFAULT_CONFIG: {
    scheduleEnabled: true,
    scheduleTime: '09:30',
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
    dailyLimit: 80,
    intervalMin: 18,
    intervalMax: 35,
    pauseOnCaptcha: true,
    skipCommunicated: true,
    onlyOnline: false,
    showNotification: false,
    blacklist: [],
    searchUrl: "https://www.zhipin.com/web/geek/jobs?query="
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
    pausedOnCaptcha: false,
    pauseReason: '',
    runId: '',
    ownerTabId: null,
    lastScheduledDate: '',
    lastResult: '',
    startedAt: 0,
    heartbeatAt: 0
  },

  // 获取配置 (带错误兜底)
  async getConfig() {
    try {
      const result = await chrome.storage.sync.get({ config: this.DEFAULT_CONFIG });
      return { ...this.DEFAULT_CONFIG, ...result.config };
    } catch (e) {
      console.error('[BossHelper] getConfig 失败:', e);
      throw e;
    }
  },

  // 保存配置
  async saveConfig(config) {
    try {
      await chrome.storage.sync.set({ config });
    } catch (e) {
      console.error('[BossHelper] saveConfig 失败:', e);
      throw e;
    }
  },

  // 获取状态 (带错误兜底)
  async getState() {
    try {
      const result = await chrome.storage.local.get({ state: this.DEFAULT_STATE });
      return { ...this.DEFAULT_STATE, ...result.state };
    } catch (e) {
      console.error('[BossHelper] getState 失败:', e);
      throw e;
    }
  },

  // 保存状态
  async saveState(state) {
    try {
      await chrome.storage.local.set({ state });
    } catch (e) {
      console.error('[BossHelper] saveState 失败:', e);
      throw e;
    }
  },

  // 更新部分状态
  async updateState(partial) {
    const state = await this.getState();
    Object.assign(state, partial);
    await this.saveState(state);
    return state;
  },

  // 初始化今天的数据 (如果日期变更则重置统计)
  async initToday() {
    const today = new Date(Date.now() + 8 * 3600000).toISOString().split('T')[0];
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
