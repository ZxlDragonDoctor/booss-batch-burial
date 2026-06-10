// content.js - BOSS 直聘页面操作核心脚本
(function () {
  'use strict';

  let isRunning = false;
  let isProcessing = false;
  let stopRequested = false;
  let processedKeys = new Set();
  let currentPageKeys = new Set();

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
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
    try { chrome.runtime.sendMessage({ type: 'POPUP_LOG', text, level }).catch(() => {}); } catch(e) {}
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

    try {
      await sleep(2000);

      while (isRunning && !stopRequested) {
        // 扫描职位
        const jobs = scanJobs();
        log(`找到 ${jobs.length} 个职位`);

        if (!jobs.length) {
          if (!await scrollPage()) break;
          await sleep(3000);
          continue;
        }

        // 检查同一页
        const keys = new Set(jobs.filter(j => j.key).map(j => j.key));
        if (keys.size > 0 && [...keys].every(k => currentPageKeys.has(k))) {
          log('同一页无新职位，翻页');
          if (!await scrollPage()) break;
          await sleep(3000);
          currentPageKeys.clear();
          continue;
        }
        currentPageKeys = keys;

        // 筛选
        const config = await Storage.getConfig();
        const filtered = jobs.filter(j => {
          if (!j.title) return false;
          const t = j.title.toLowerCase();
          const kw = config.keywords || [];
          if (kw.length && !kw.some(k => t.includes(k.toLowerCase()))) return false;
          const ex = config.excludeKeywords || [];
          if (ex.length && ex.some(k => t.includes(k.toLowerCase()))) return false;
          if (j.key && processedKeys.has(j.key)) return false;
          return true;
        });

        log(`筛选通过 ${filtered.length}/${jobs.length}`);

        if (!filtered.length) {
          if (!await scrollPage()) break;
          await sleep(3000);
          continue;
        }

        // 处理每个职位
        for (const job of filtered) {
          if (!isRunning || stopRequested) break;

          const state = await Storage.getState();
          if (state.todayCount >= config.dailyLimit) {
            log('已达日限额', 'warn');
            chrome.runtime.sendMessage({ type: 'STOP' }).catch(() => {});
            isRunning = false;
            break;
          }

          log(`▶ ${job.title} @ ${job.company || '未知公司'}`);
          if (job.key) processedKeys.add(job.key);

          // ========== 点击职位卡片 ==========
          if (job.clickable) {
            try { job.clickable.click(); } catch(e) {}
          }
          await sleep(2000 + Math.random() * 1000);

          // 关掉可能弹出的"选择原因"反馈弹窗
          dismissFeedbackDialog();
          await sleep(500);

          // ========== 查找打招呼按钮 ==========
          const btn = findGreetBtn();
          if (!btn) {
            log(`⏭ ${job.title} 无可打招呼按钮`, 'warn');
            chrome.runtime.sendMessage({ type: 'UPDATE_STATS', data: { skippedCount: 1 } }).catch(() => {});
            // 仍然尝试关闭面板
            closeDetailPanel();
            await sleep(1000);
            continue;
          }

          // ========== 点击打招呼 ==========
          log(`👉 点击 "${btn.textContent.trim()}"`, 'info');
          try { btn.click(); } catch(e) {}
          await sleep(2000 + Math.random() * 1500);

          // ========== 检查是否有输入框（自定义消息） ==========
          const textarea = document.querySelector('textarea');
          if (textarea && textarea.offsetParent !== null) {
            const msgs = config.greetingMessages || ['您好，我对该职位很感兴趣，方便看看我的简历吗？'];
            let msg = msgs[Math.floor(Math.random() * msgs.length)];
            if (config.useCompanyPlaceholder) msg = msg.replace(/\{公司名\}/g, job.company || '贵公司');
            if (config.useJobPlaceholder) msg = msg.replace(/\{职位名\}/g, job.title);
            textarea.value = msg;
            textarea.dispatchEvent(new Event('input', { bubbles: true }));
            log(`📝 输入消息: "${msg.substring(0, 30)}..."`, 'info');
            await sleep(800 + Math.random() * 700);

            // 找发送按钮（优先在对话框内找）
            const dialog = textarea.closest('[class*="dialog"], [class*="modal"], [class*="popup"]');
            const root = dialog || document;
            const sendBtns = root.querySelectorAll('button, [class*="btn"]');
            let sent = false;
            for (const s of sendBtns) {
              if (s.offsetParent === null) continue;
              const t = s.textContent.trim();
              if (/^(发送|提交|确定|确认|立即发送)$/.test(t)) {
                log(`📤 点击发送按钮 "${t}"`, 'info');
                try { s.click(); } catch(e) {}
                sent = true;
                break;
              }
            }
            if (!sent) {
              // Fallback: 找所有可见按钮
              const all = document.querySelectorAll('button');
              for (const s of all) {
                if (s.offsetParent === null) continue;
                if (/^(发送|提交|确定|确认|立即发送)$/.test(s.textContent.trim())) {
                  try { s.click(); } catch(e) {}
                  sent = true;
                  break;
                }
              }
            }
            await sleep(2500 + Math.random() * 1500);
          } else {
            // 无文本输入框 - 可能是简单模式，等一会儿
            log('无输入框，等待');
            await sleep(2000 + Math.random() * 1000);
          }

          // ========== 检测是否风控 ==========
          if (isRateLimited()) {
            log('⛔ 风控限制，暂停', 'error');
            chrome.runtime.sendMessage({ type: 'PAUSE' }).catch(() => {});
            isRunning = false;
            break;
          }

          // ========== 成功投递 ==========
          log(`✅ ${job.title} @ ${job.company || ''}`, 'success');
          chrome.runtime.sendMessage({
            type: 'UPDATE_STATS',
            data: { todayCount: 1, communicatedCount: 1, newTotal: 1 }
          }).catch(() => {});

          // ========== 清理：先关弹窗，再关面板 ==========
          // 先关弹出层（它在上层，挡住面板）
          await dismissSuccessPopup();
          await sleep(500);
          // 再关详情面板
          closeDetailPanel();
          await sleep(500);

          // ========== 随机间隔 ==========
          const min = config.intervalMin || 18;
          const max = config.intervalMax || 35;
          const delay = min + Math.random() * (max - min);
          log(`⏳ 等待 ${delay.toFixed(1)} 秒...`, 'info');
          await sleep(delay * 1000);

          // 再次检查风控（间隔期间可能被风控）
          if (isRateLimited()) {
            log('⛔ 检测到风控，停止', 'error');
            chrome.runtime.sendMessage({ type: 'PAUSE' }).catch(() => {});
            isRunning = false;
            break;
          }
        }
      }
    } catch (err) {
      console.error('[BossHelper]', err);
      log('❌ 错误: ' + err.message, 'error');
    }

    isProcessing = false;
    chrome.runtime.sendMessage({ type: 'STOP' }).catch(() => {});
  }

  // ============================================================
  // 扫描职位卡片
  // ============================================================
  function scanJobs() {
    const jobs = [];
    const selectors = [
      '[class*="job-list"] [class*="card"]',
      '.job-list-box > li',
      '.job-list-box > div',
      '[class*="job-card"]',
      '[class*="position"] [class*="item"]',
      '[class*="recruit"] [class*="item"]',
      '[class*="job"] [class*="list"] [class*="item"]',
    ];
    const cards = document.querySelectorAll(selectors.join(', '));

    if (cards.length === 0) {
      log('⚠️ 未匹配到任何卡片（点击诊断查看详情）', 'warn');
    }

    cards.forEach((card) => {
      const text = (card.textContent || '').trim().replace(/\s+/g, ' ');
      const link = card.querySelector('a');

      // 提取标题：在 BOSS 直聘 DOM 中，第一个 a 标签通常是标题
      let title = '';
      const allLinks = card.querySelectorAll('a');
      for (const a of allLinks) {
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
      let company = '';
      const areaMatch = text.match(/[^\s]+[·][^\s]*[区市县]/);
      if (areaMatch && title) {
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
      const key = (title + '|' + (company || '')).toLowerCase();

      jobs.push({
        key,
        title: title || '未知',
        company: company || '',
        clickable: link || card,
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
    // 明确排除
    if (/继续沟通/.test(t)) return false;
    // 精确匹配主要按钮文本
    if (/^(打招呼|立即沟通|聊一聊|投递)$/.test(t)) return true;
    // 模糊匹配（针对带图标/状态文字的情况如 "立即沟通 在线"）
    if (/^(打招呼|立即沟通|聊一聊)/.test(t.replace(/\s+/g, ''))) return true;
    return false;
  }

  function findGreetBtn() {
    // 优先在详情/右侧面板找
    const panel = document.querySelector(
      '[class*="detail"], .job-detail, [class*="side"], [class*="right"], [class*="main"]'
    );
    const root = panel || document;

    // 选择器覆盖可能的按钮实现
    const btns = root.querySelectorAll(
      'button, a[class*="btn"], [class*="chat"], [class*="greet"], ' +
      '[class*="operate"], [class*="action"]'
    );
    for (const btn of btns) {
      if (btn.offsetParent === null) continue;
      if (isGreetBtn(btn)) return btn;
    }
    // 全页搜索备选
    const all = document.querySelectorAll(
      'button, a[class*="btn"], [class*="chat"], [class*="greet"]'
    );
    for (const btn of all) {
      if (btn.offsetParent === null) continue;
      if (isGreetBtn(btn)) return btn;
    }
    return null;
  }

  // ============================================================
  // 翻页（滚动加载更多）
  // ============================================================
  async function scrollPage() {
    log('📜 开始翻页...', 'info');

    const before = document.body.scrollHeight || 0;

    // 策略 1: window.scrollTo（最通用）
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
    // 派发 scroll 事件通知页面
    window.dispatchEvent(new Event('scroll', { bubbles: true }));
    await sleep(2000);

    // 策略 2: 找可滚动容器
    const containers = document.querySelectorAll(
      '.job-list-box, [class*="job-list"], [class*="scroll"], ' +
      '.page-jobs, [class*="container"]'
    );
    for (const el of containers) {
      if (el.scrollHeight > el.clientHeight + 50) {
        el.scrollTop = el.scrollHeight;
        el.dispatchEvent(new Event('scroll', { bubbles: true }));
        await sleep(1000);
      }
    }

    // 策略 3: 再次滚动到底 + 等待更久（给 API 加载时间）
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
    window.dispatchEvent(new Event('scroll', { bubbles: true }));
    await sleep(3000);

    const after = document.body.scrollHeight || 0;
    if (after > before + 50) {
      log(`📜 翻页成功 (${before}→${after})`, 'success');
      return true;
    }

    log('📜 翻页失败，已到底', 'warn');
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
    const closeSelectors = [
      '[class*="detail"] [class*="close"]',
      '[class*="side"] [class*="close"]',
      '.job-detail [class*="close"]',
      '[class*="detail"] .icon-close',
      '.close',
      '[class*="detail"] button[class*="close"]',
    ];
    for (const sel of closeSelectors) {
      const btn = document.querySelector(sel);
      if (btn && btn.offsetParent !== null) {
        try { btn.click(); } catch(e) {}
        return;
      }
    }
    // 按 Escape
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    document.body.click();
  }

  // ============================================================
  // 增强风控检测
  // ============================================================
  function isRateLimited() {
    // inline cursor
    if (document.body.style.cursor === 'not-allowed') return true;
    // computed cursor
    try {
      const computed = window.getComputedStyle(document.body).cursor;
      if (computed === 'not-allowed') return true;
    } catch(e) {}
    return false;
  }

  // ============================================================
  // MutationObserver: 自动检测并关闭弹窗
  // ============================================================
  function startAutoDismiss() {
    if (autoDismissObserver) return;
    autoDismissObserver = new MutationObserver(() => {
      if (!isRunning) return;
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

  log('✅ 已加载');
})();
