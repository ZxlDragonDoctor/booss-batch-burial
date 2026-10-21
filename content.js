// content.js - BOSS 直聘页面操作核心脚本
(function () {
  'use strict';

  let isRunning = false;
  let isProcessing = false;
  let stopRequested = false;
  let processedKeys = new Set();
  let currentPageKeys = new Set();
  let runId = '';
  let successObserved = false;
  let awaitingSuccess = false;
  const jobListUrl = location.href;
  const request = (type, data = {}) => chrome.runtime.sendMessage({ type, runId, ...data });
  const visible = el => Boolean(el && el.getClientRects().length);
  function blockingReason() {
    if (/passport|login/.test(location.pathname)) return '登录已失效，请先登录';
    const nodes = document.querySelectorAll('[class*="verify"], [class*="captcha"], [class*="dialog"], [class*="modal"], [class*="toast"], iframe');
    for (const el of nodes) {
      if (!visible(el)) continue;
      if (/captcha|verify|geetest/.test(el.className + ' ' + (el.src || ''))) return '请手动完成安全验证';
      if (/验证码|安全验证|滑块|操作频繁|访问异常|账号异常|今日.*上限|沟通.*上限|明天再来/.test(el.textContent)) return '平台验证或频率限制，请处理后继续';
      if (/扫码登录|登录后继续|请先登录|短信登录/.test(el.textContent)) return '请先登录 BOSS 直聘';
    }
    return '';
  }
  async function check() {
    if (!isRunning || stopRequested) return false;
    const reason = blockingReason();
    if (reason) {
      isRunning = false;
      await request('PAUSE', { reason });
      return false;
    }
    const state = await request('HEARTBEAT');
    if (!state?.ok) isRunning = false;
    return isRunning && !stopRequested;
  }
  async function wait(ms) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (!await check()) return false;
      await sleep(Math.min(500, end - Date.now()));
    }
    return check();
  }
  function observeSuccess() {
    if (!awaitingSuccess) return;
    for (const el of document.querySelectorAll('[class*="dialog"], [class*="modal"], [class*="toast"], [class*="popup"]')) {
      if (visible(el) && /已向.*发送|已发送.*招呼|打招呼成功|投递成功|发送成功/.test(el.textContent)) successObserved = true;
    }
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message.type) {
      case 'START_BATCH':
        if (isProcessing) {
          sendResponse({ status: runId === message.runId && !stopRequested ? 'ok' : 'busy' });
          return;
        }
        runId = message.runId;
        isRunning = true;
        stopRequested = false;
        sendResponse({ status: 'ok' });
        startBatch();
        break;
      case 'STOP_BATCH':
        if (message.runId && message.runId !== runId) return;
        isRunning = false;
        stopRequested = true;
        break;
      case 'PING':
        sendResponse({ status: 'ok' });
        break;
      case 'DIAGNOSE':
        diagnoseDOM().then(result => sendResponse(result));
        return true; // keep sendResponse alive
    }
  });

  function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  function log(text, level = 'info') {
    try { chrome.runtime.sendMessage({ type: 'CONTENT_LOG', text, level }).catch(() => {}); } catch(e) {}
    console.log('[BossHelper]', text);
  }

  // ============================================================
  // DOM 诊断工具 - 从 popup 触发，打印页面结构
  // ============================================================
  let autoDismissObserver = null;

  async function diagnoseDOM() {
    const results = {
      url: location.href,
      cardsFound: 0,
      cardSelectors: {},
      greetButtons: [],
      textareas: 0,
      dialogs: [],
      detailPanels: 0,
      bodyCursor: document.body.style.cursor,
    };

    // 各种选择器测试
    const selectors = [
      '[class*="job-list"] [class*="card"]',
      '.job-list-box > li',
      '.job-list-box > div',
      '[class*="job-card"]',
      '[class*="position"] [class*="item"]',
      '[class*="recruit"] [class*="item"]',
    ];
    selectors.forEach(sel => {
      const els = document.querySelectorAll(sel);
      results.cardSelectors[sel] = els.length;
      if (els.length > 0 && !results.cardsFound) {
        results.cardsFound = els.length;
        results.bestSelector = sel;
        // 取第一个卡片的 classList
        if (els[0].className) {
          results.sampleClasses = typeof els[0].className === 'string' ? els[0].className : Array.from(els[0].classList);
        }
      }
    });

    // 查找所有按钮
    document.querySelectorAll('button, a[class*="btn"]').forEach(btn => {
      if (btn.offsetParent === null) return;
      const text = btn.textContent.trim();
      if (/打招|沟通|聊一聊|投递|发送/.test(text)) {
        results.greetButtons.push({
          text: text,
          visible: btn.offsetParent !== null,
          classes: btn.className && typeof btn.className === 'string' ? btn.className.substring(0, 100) : '',
        });
      }
    });

    // 查找对话框
    document.querySelectorAll('[class*="dialog"], [class*="modal"], [class*="popup"], [class*="toast"]').forEach(el => {
      if (el.offsetParent === null) return;
      const info = {
        tag: el.tagName,
        classes: typeof el.className === 'string' ? el.className.substring(0, 120) : '',
        id: el.id || '',
        text: el.textContent.replace(/\s+/g, ' ').substring(0, 100),
        hasClose: !!el.querySelector('[class*="close"], button'),
      };
      results.dialogs.push(info);
    });

    // 额外：按文本搜索隐藏的弹窗
    document.querySelectorAll('div').forEach(el => {
      if (el.offsetParent === null) return;
      const text = el.textContent.trim();
      if (/选择原因|减少不合适|不感兴趣/.test(text) && el.children.length < 20) {
        results.dialogs.push({
          tag: el.tagName,
          classes: typeof el.className === 'string' ? el.className.substring(0, 120) : '(by text match)',
          id: el.id || '',
          text: text.substring(0, 100),
          hasClose: !!el.querySelector('[class*="close"], button'),
        });
      }
    });

    results.isLoggedIn = !blockingReason();
    results.isOnJobList = /\/web\/geek\/jobs?/.test(location.pathname);
    results.textareas = document.querySelectorAll('textarea').length;
    results.detailPanels = document.querySelectorAll('[class*="detail"], .job-detail, [class*="side"]').length;

    log('🔍 诊断结果: ' + JSON.stringify(results, null, 2).substring(0, 2000), 'info');
    return results;
  }

  // ============================================================
  // 主流程
  // ============================================================
  async function startBatch() {
    if (isProcessing) return;
    isProcessing = true;
    let reason = '没有更多匹配职位';
    try {
      if (!await wait(2000)) return;
      processedKeys = new Set(Object.keys((await chrome.storage.local.get({ records: {} })).records));
      currentPageKeys.clear();
      while (await check()) {
        if (await goBackIfOnChatPage()) {
          if (!await wait(1500)) break;
          continue;
        }
        const config = await Storage.getConfig();
        const jobs = scanJobs().filter(job => {
          const title = job.title.toLowerCase();
          return title && title !== '未知' && !processedKeys.has(job.key) &&
            (!config.keywords.length || config.keywords.some(k => title.includes(k.toLowerCase()))) &&
            !(config.excludeKeywords || []).some(k => title.includes(k.toLowerCase())) &&
            !(config.blacklist || []).some(k => job.company.toLowerCase().includes(k.toLowerCase())) &&
            (!config.skipCommunicated || !/已沟通|继续沟通/.test(job.clickable.textContent)) &&
            (!config.onlyOnline || /在线/.test(job.clickable.textContent));
        });
        log(`匹配到 ${jobs.length} 个待沟通职位`);
        if (!jobs.length) {
          if (!await scrollPage()) break;
          continue;
        }
        for (const job of jobs) {
          if (!await check()) break;
          if (!job.clickable.isConnected) continue;
          processedKeys.add(job.key);
          job.clickable.click();
          if (!await wait(1800)) break;
          const btn = findGreetBtn(job);
          if (!btn || /继续沟通|已沟通/.test(btn.textContent)) {
            log(`跳过 ${job.title}：未找到可核对职位和公司的沟通按钮`, 'warn');
            await request('SKIP_JOB');
            closeDetailPanel();
            continue;
          }
          // Record before the first action that may send a message.
          const reserved = await request('RESERVE_JOB', { job: { key:job.key,title:job.title,company:job.company } });
          if (!reserved?.ok) { closeDetailPanel(); continue; }
          if (!await check()) break;
          successObserved = false;
          awaitingSuccess = true;
          btn.click();
          if (!await wait(1800)) break;
          const dialog = [...document.querySelectorAll('[class*="dialog"], [class*="modal"], [class*="popup"]')]
            .find(el => visible(el) && el.querySelector('textarea'));
          const textarea = dialog?.querySelector('textarea');
          if (visible(textarea)) {
            const messages = config.greetingMessages;
            let text = messages[Math.floor(Math.random() * messages.length)];
            text = text.replace(/\{公司名\}/g, job.company || '贵公司').replace(/\{职位名\}/g, job.title);
            Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(textarea, text);
            textarea.dispatchEvent(new Event('input', {bubbles:true}));
            const send = [...dialog.querySelectorAll('button, a[class*="btn"]')]
              .find(el => visible(el) && !el.disabled && /^(发送|立即发送|确定)$/.test(el.textContent.trim()));
            if (send && await check()) send.click();
          }
          const deadline = Date.now() + 8000;
          while (Date.now() < deadline && await check()) {
            observeSuccess();
            if (btn.isConnected && /继续沟通|已沟通/.test(btn.textContent)) successObserved = true;
            if (successObserved) break;
            await sleep(250);
          }
          awaitingSuccess = false;
          if (!isRunning || stopRequested) break;
          const status = successObserved ? 'confirmed' : 'unknown';
          await request('JOB_RESULT', {key:job.key,status});
          log(`${successObserved ? '已确认沟通' : '结果待核查'}：${job.title} @ ${job.company}`);
          if (!successObserved || !await check()) break;
          await dismissSuccessPopup();
          closeDetailPanel();
          const delay = config.intervalMin + Math.random() * (config.intervalMax - config.intervalMin);
          if (!await wait(delay * 1000)) break;
        }
      }
    } catch (error) {
      reason = '运行异常：' + error.message;
      await request('PAUSE', {reason}).catch(() => {});
    } finally {
      awaitingSuccess = false;
      isRunning = false;
      isProcessing = false;
      await request('FINISH', {reason}).catch(() => {});
    }
  }

  function scanJobs() {
    const jobs = [];
    const selectors = [
      '.job-card-box',
      '.job-card-wrap',
      '.job-list-box > li',
      '.job-list-box > div',
      '[class*="job-card"]',
    ];
    const cards = document.querySelectorAll(selectors.join(', '));

    if (cards.length === 0) {
      log('⚠️ 未匹配到任何卡片（点击诊断查看详情）', 'warn');
    }

    cards.forEach((card) => {
      const rawText = (card.textContent || '').trim().replace(/\s+/g, ' ');
      const text = rawText.replace(/[-]/g, '').trim();
      const link = card.querySelector('a[href*="/job_detail/"]') || card.querySelector('a');

      // 提取标题：在 BOSS 直聘 DOM 中，第一个 a 标签通常是标题
      let title = card.querySelector('.job-name, .job-title, [class*="job-name"]')?.textContent.trim() || '';
      const allLinks = card.querySelectorAll('a');
      for (const a of title ? [] : allLinks) {
        const t = a.textContent.trim();
        if (t.length >= 4 && t.length < 40 && !/K·|[0-9]/.test(t) && !/[区市县]/.test(t) && !/科技|有限|公司|集团|股份|工厂|工作室/.test(t)) {
          title = t;
          break; // 取第一个匹配的（标题总是在公司名之前）
        }
      }
      // 从全文本里找（备选）
      if (!title) {
        const parts = text.split(/[\s]+/);
        for (const p of parts) {
          if (p.length >= 4 && !/K·|[0-9\-]/.test(p) && !/[区市县]/.test(p) && !/经验|学历|本科|大专|应届/.test(p) && !/科技|有限|公司|集团|股份|工厂|工作室/.test(p)) {
            title = p; break;
          }
        }
      }

      // 提取公司名
      let company = card.querySelector('.company-name, [class*="company-name"]')?.textContent.trim() || '';
      const areaMatch = text.match(/[^\s]+[·][^\s]*[区市县]/);
      if (!company && areaMatch && title) {
        const idx = text.indexOf(title);
        if (idx >= 0) {
          const afterTitle = text.substring(idx + title.length);
          const beforeArea = afterTitle.substring(0, afterTitle.indexOf(areaMatch[0]));
          const cleaned = beforeArea
            .replace(/[0-9-Kk\-·~～]+/g, '')
            .replace(/在校|应届|本科|大专|硕士|博士|经验|学历/g, '')
            .replace(/\b[A-Za-z#+()（）]+\b/g, '')
            .replace(/[・\s]/g, '')
            .trim();
          if (cleaned.length >= 2) company = cleaned;
        }
      }

      if (!company && text) {
        const m = text.match(/([^\s]{2,10}(?:科技|有限|公司|集团|股份|工作室|软件|网络|技术|信息|咨询|国际|企业|工厂|中心))/);
        if (m) {
          company = m[1];
          // 清除公司名前缀中的残留标签字符如 "年" "应届" "本科"
          company = company.replace(/^[0-9\-]+年/, '').replace(/^年/, '');
          if (company.length < 2) company = ''; // 清除后太短则放弃
        }
      }

      // 如果还没找到公司名，尝试另一种方式
      if (!company) {
        // 找可能包含公司名的元素
        const allSpans = card.querySelectorAll('span, div, a');
        for (const el of allSpans) {
          const t = (el.textContent || '').trim();
          if (t.length >= 2 && t.length <= 20 && /科技|有限|公司|集团|股份|工作室/.test(t) && !/[区市县]/.test(t)) {
            company = t;
            break;
          }
        }
      }

      // 去重 key
      const id = link?.getAttribute('href')?.match(/\/job_detail\/([^/?#.]+)/)?.[1];
      const key = id ? 'job:' + id : (title + '|' + (company || '') + '|' + (card.querySelector('.job-area')?.textContent || '')).toLowerCase();

      jobs.push({
        key,
        title: title || '未知',
        company: company || '',
        clickable: card,
      });
    });

    // 去重（同一页可能有多个匹配）
    const seen = new Set();
    return jobs.filter(j => {
      if (seen.has(j.key)) return false;
      seen.add(j.key);
      return true;
    });
  }

  // ============================================================
  // 查找"打招呼"按钮
  // ============================================================
  function isGreetBtn(el) {
    const t = el.textContent.trim();
    if (/^(打招呼|立即沟通|聊一聊|投递)$/.test(t)) return true;
    if (/^(打招呼|立即沟通|聊一聊)/.test(t.replace(/\s+/g, ''))) return true;
    return false;
  }

  function findGreetBtn(job) {
    const buttonIn = root => [...root.querySelectorAll('button, a[class*="btn"], [class*="chat"], [class*="greet"]')]
      .find(el => visible(el) && !el.disabled && isGreetBtn(el));
    // A button belonging to the original card has an unambiguous recipient.
    const cardButton = buttonIn(job.clickable);
    if (cardButton) return cardButton;
    const normalize = text => (text || '').replace(/\s+/g, '').toLowerCase();
    for (const panel of document.querySelectorAll('.job-detail, .job-detail-box, .job-detail-container, .job-detail-wrap, [class*="job-detail"]')) {
      if (!visible(panel)) continue;
      const title = panel.querySelector('.job-name, .job-title, h1, h2');
      const company = panel.querySelector('.company-name, [class*="company-name"]');
      if (normalize(title?.textContent) !== normalize(job.title)) continue;
      if (job.company && normalize(company?.textContent) !== normalize(job.company)) continue;
      const button = buttonIn(panel);
      if (button) return button;
    }
    return null;
  }

  // ============================================================
  // 翻页（滚动加载更多）
  // ============================================================
  async function scrollPage() {
    if (!await check()) return false;
    log('📜 开始翻页...', 'info');

    const cardsBefore = document.querySelectorAll('.job-card-box, .job-card-wrap, [class*="job-card"]').length;
    const before = document.body.scrollHeight || 0;

    // 策略 1: 找可滚动容器 (排除 detail 面板)
    const containers = document.querySelectorAll(
      '.job-list-box, [class*="job-list"]:not([class*="detail"]), ' +
      '[class*="scroll"]:not([class*="detail"]), ' +
      '.page-jobs, [class*="container"]:not([class*="detail"])'
    );
    let scrolled = false;
    for (const el of containers) {
      if (el.scrollHeight > el.clientHeight + 50) {
        el.scrollTop = el.scrollHeight;
        el.dispatchEvent(new Event('scroll', { bubbles: true }));
        await sleep(1500);
        scrolled = true;
        break;
      }
    }

    // 策略 2: 滚动 body
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
    window.dispatchEvent(new Event('scroll', { bubbles: true }));
    await sleep(3000);

    const after = document.body.scrollHeight || 0;
    const cardsAfter = document.querySelectorAll('.job-card-box, .job-card-wrap, [class*="job-card"]').length;

    if (cardsAfter > cardsBefore || after > before + 50) {
      log(`📜 翻页成功 (卡片: ${cardsBefore}→${cardsAfter}, 高度: ${before}→${after})`, 'success');
      return true;
    }

    log('📜 翻页失败，已到底或无更多内容', 'warn');
    return false;
  }

  // ============================================================
  // 关闭成功弹窗 — 点击"留在此页"自然关闭
  // ============================================================
  async function dismissSuccessPopup() {
    // 找成功弹窗（按文本匹配）
    for (let attempt = 0; attempt < 5; attempt++) {
      let found = false;

      // 策略 1: 在弹窗类元素中找"留在此页"按钮
      const popups = document.querySelectorAll(
        '[class*="dialog"], [class*="modal"], [class*="popup"], ' +
        '[class*="toast"], [class*="tip"], [class*="message"]'
      );
      for (const el of popups) {
        if (el.offsetParent === null) continue;
        const text = el.textContent.trim();
        // 确认是成功弹窗（包含已发送等关键词）
        if (!/已向|已发送|打招呼成功|投递成功/.test(text)) continue;
        found = true;

        // 找"留在此页"按钮
        const btns = el.querySelectorAll('button, a[class*="btn"]');
        let handled = false;
        for (const b of btns) {
          if (b.offsetParent === null) continue;
          const bt = b.textContent.trim();
          if (/留在此页/.test(bt)) {
            log(`👆 点击"${bt}"`, 'info');
            try { b.click(); } catch(e) {}
            handled = true;
            break;
          }
        }
        if (!handled) {
          // 没找到"留在此页"，点任意关闭/确定按钮
          for (const b of btns) {
            if (b.offsetParent === null) continue;
            const bt = b.textContent.trim();
            if (/关闭|确定|知道|好的/.test(bt)) {
              try { b.click(); } catch(e) {}
              handled = true;
              break;
            }
          }
        }
        if (!handled) {
          // 仍然没找到，按 Escape
          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
        }
      }

      // 策略 2: 全页找"留在此页"按钮（兜底）
      if (!found) {
        const all = document.querySelectorAll('button, a[class*="btn"]');
        for (const b of all) {
          if (b.offsetParent === null) continue;
          if (/留在此页/.test(b.textContent.trim())) {
            log(`👆 全页找到"${b.textContent.trim()}"`, 'info');
            try { b.click(); } catch(e) {}
            found = true;
            break;
          }
        }
      }

      if (found) {
        await sleep(500);
      } else {
        break; // 没弹窗了，退出
      }
    }
  }

  // ============================================================
  // 关闭"选择原因"反馈弹窗（点击卡片后 BOSS 反爬弹窗）
  // ============================================================
  function dismissFeedbackDialog() {
    // 全页搜索包含"选择原因"的可见弹窗
    const allDivs = document.querySelectorAll('div');
    for (const el of allDivs) {
      if (el.offsetParent === null) continue;
      if (el.children.length > 20) continue; // 太复杂不是弹窗
      const text = el.textContent.trim();
      if (!/选择原因/.test(text)) continue;

      log('🔍 检测到反馈弹窗，点击取消', 'warn');
      // 找"取消"按钮
      const btns = el.querySelectorAll('button, a');
      for (const b of btns) {
        if (b.offsetParent === null) continue;
        if (/^取消$/.test(b.textContent.trim())) {
          try { b.click(); } catch(e) {}
          return;
        }
      }
      // 没找到取消按钮，找 X 关闭按钮
      const xBtn = el.querySelector('[class*="close"], [class*="icon-close"], [aria-label*="close"]');
      if (xBtn && xBtn.offsetParent !== null) {
        try { xBtn.click(); } catch(e) {}
        return;
      }
      // 最后按 Escape
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      return;
    }
  }

  // ============================================================
  // 关闭右侧详情面板
  // ============================================================
  function closeDetailPanel() {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    document.body.click();
  }

  // ============================================================
  // 增强风控检测
  // ============================================================
  function isRateLimited() { return Boolean(blockingReason()); }

  // ============================================================
  // MutationObserver: 自动检测并关闭弹窗
  // ============================================================
  function startAutoDismiss() {
    if (autoDismissObserver) return;
    autoDismissObserver = new MutationObserver(() => {
      if (!isRunning) return;
      observeSuccess();
      // 只在弹窗类元素中查找，排除 app/layout/page 等主容器
      const popups = document.querySelectorAll(
        '[class*="dialog"]:not([class*="app"]):not([class*="layout"]):not([class*="page"]):not([class*="wrap"]), ' +
        '[class*="modal"], [class*="popup"], [class*="toast"], [class*="mask"]'
      );
      for (const el of popups) {
        if (el.offsetParent === null) continue;
        const text = el.textContent.trim();
        // 成功弹窗 — 点"留在此页"
        if (/已向|已发送|打招呼成功|投递成功/.test(text)) {
          const btns = el.querySelectorAll('button, a[class*="btn"]');
          for (const b of btns) {
            if (b.offsetParent === null) continue;
            if (/留在此页|关闭|确定|知道|好的/.test(b.textContent.trim())) {
              try { b.click(); } catch(e) {}
              break;
            }
          }
        }
        // 反馈弹窗 ("选择原因")
        if (/选择原因/.test(text) && el.children.length < 15 && el.querySelector('button')) {
          const cancelBtn = el.querySelector('button');
          if (cancelBtn && /^取消$/.test(cancelBtn.textContent.trim())) {
            try { cancelBtn.click(); } catch(e) {}
          } else {
            el.style.display = 'none';
          }
        }
      }
    });
    autoDismissObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: false,
    });
  }

  // 启动自动弹窗检测
  startAutoDismiss();
  chrome.runtime.sendMessage({ type: 'READY' }).catch(() => {});

  // ============================================================
  // 聊天页检测与返回
  // ============================================================
  function isOnChatPage() {
    if (/\/chat\/|\/im\/|web\/chat|geek\/chat/.test(location.href)) return true;
    try {
      return !!document.querySelector(
        '[class*="chat-container"], [class*="im_container"], ' +
        '[class*="message-chat"], [class*="session-list"], ' +
        '[class*="chat-header"]'
      );
    } catch(e) { return false; }
  }

  async function goBackIfOnChatPage() {
    if (!isOnChatPage()) return false;
    log('⚠️ 误入聊天页面，尝试返回...', 'warn');
    try {
      window.history.back();
      await sleep(2000);
      if (!isOnChatPage()) {
        log('✅ history.back() 返回成功');
        return true;
      }
    } catch(e) {}
    if (jobListUrl && jobListUrl !== location.href && jobListUrl !== 'about:blank') {
      log('⚠️ 使用 location.href 返回', 'warn');
      location.href = jobListUrl;
      await sleep(3000);
      return true;
    }
    return false;
  }

  log('✅ 已加载');
})();
