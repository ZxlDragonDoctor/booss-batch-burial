// Real MV3 extension in a new disposable Edge profile; all BOSS requests are fixtures.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {chromium}=require('playwright');
test('真实 Edge 扩展：控制面板启动、内容脚本沟通、后台确认并按额度停止', {timeout:30000}, async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'boss-mv3-test-'));
  const extension=process.cwd();
  let ctx;
  try {
    ctx=await chromium.launchPersistentContext(dir,{channel:'msedge',headless:true,
      args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
    const worker=ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker',{timeout:10000});
    await worker.evaluate(async()=>{
      await chrome.storage.sync.set({config:{keywords:['Java'],scheduleEnabled:false,dailyLimit:1}});
    });
    await ctx.route('https://www.zhipin.com/**',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:`<!doctype html><html><head><meta charset="UTF-8"></head><body>
      <div class="job-card-box"><a href="/job_detail/integration123.html"><span class="job-name">Java后端开发</span></a><span class="company-name">测试科技</span></div>
      <div class="job-detail"><h2>Java后端开发</h2><span class="company-name">测试科技</span><button onclick="this.textContent='继续沟通'">立即沟通</button></div>
      </body></html>`}));
    const boss=await ctx.newPage();
    await boss.goto('https://www.zhipin.com/web/geek/jobs');
    const popup=await ctx.newPage();
    await popup.goto(worker.url().replace('/background.js','/popup/popup.html'));
    await popup.locator('#toggleBtn').click();
    try {
      await popup.waitForFunction(()=>document.querySelector('#todayCount').textContent==='1',null,{timeout:18000});
    } catch (error) {
      console.log(JSON.stringify(await worker.evaluate(async()=>chrome.storage.local.get(null))));
      console.log(await popup.locator('body').innerText());
      throw error;
    }
    const result=await worker.evaluate(async()=>chrome.storage.local.get({state:{},records:{}}));
    assert.equal(result.state.isRunning,false);
    assert.equal(result.state.todayCount,1);
    assert.equal(result.records['job:integration123'].status,'confirmed');
    assert.equal(result.state.pausedOnCaptcha,false);
  } finally {
    if(ctx) await ctx.close();
    // Only remove the exact newly created disposable profile under the temp root.
    const target=path.resolve(dir), root=path.resolve(os.tmpdir());
    if(path.dirname(target)===root && path.basename(target).startsWith('boss-mv3-test-')) fs.rmSync(target,{recursive:true,force:true,maxRetries:3});
  }
});
