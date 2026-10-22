const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {chromium}=require('playwright');
test('真实扩展跨完整详情页恢复任务、返回列表，并持久跳过已完成岗位',{timeout:60000},async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'boss-nav-test-'));
  let ctx;
  try {
    ctx=await chromium.launchPersistentContext(dir,{channel:'msedge',headless:true,args:[`--disable-extensions-except=${process.cwd()}`,`--load-extension=${process.cwd()}`]});
    const worker=ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker',{timeout:10000});
    await worker.evaluate(async()=>chrome.storage.sync.set({config:{keywords:['Java'],scheduleEnabled:false,dailyLimit:2,intervalMin:1,intervalMax:1}}));
    const navigations=[];
    await ctx.route('https://www.zhipin.com/**',route=>{
      const url=new URL(route.request().url());navigations.push(url.pathname);
      const id=url.pathname.match(/\/job_detail\/(old|one|two)\.html/)?.[1];
      const body=id ? `<div class="job-banner"><h1>Java开发${id}</h1><a class="btn-startchat" href="javascript:void(0)" onclick="this.textContent='继续沟通'">${id==='old'?'继续沟通':'立即沟通'}</a></div>` :
        ['old','one','two'].map(id=>`<div class="job-card-wrapper"><a class="job-card-left" href="/job_detail/${id}.html" target="_blank"><div class="job-name"><span class="job-title">Java开发${id}</span><span class="salary">-K</span></div></a><span class="company-name">测试公司${id}</span></div>`).join('');
      return route.fulfill({contentType:'text/html; charset=utf-8',body:'<!doctype html><meta charset="utf-8"><body>'+body+'</body>'});
    });
    const boss=await ctx.newPage();await boss.goto('https://www.zhipin.com/web/geek/jobs?query=Java&city=101020100');
    const popup=await ctx.newPage();await popup.goto(worker.url().replace('/background.js','/popup/popup.html'));
    await popup.locator('#toggleBtn').click();
    try {await popup.waitForFunction(()=>document.querySelector('#todayCount').textContent==='2',null,{timeout:45000});}
    catch(error){console.log(JSON.stringify(await worker.evaluate(()=>chrome.storage.local.get(null))));throw error;}
    const {state,records}=await worker.evaluate(()=>chrome.storage.local.get(null));
    assert.equal(state.isRunning,false);
    assert.equal(records['job:one'].status,'confirmed');
    assert.equal(records['job:two'].status,'confirmed');
    assert.equal(records['job:old'].status,'existing');
    assert.equal(navigations.filter(url=>url==='/job_detail/old.html').length,1);
    assert.equal(navigations.filter(url=>url==='/job_detail/one.html').length,1);
    assert.ok(navigations.filter(url=>url==='/web/geek/jobs').length>=2);
  }finally{
    if(ctx)await ctx.close();
    const target=path.resolve(dir),root=path.resolve(os.tmpdir());
    if(path.dirname(target)===root && path.basename(target).startsWith('boss-nav-test-'))fs.rmSync(target,{recursive:true,force:true,maxRetries:3});
  }
});
