const test = require('node:test');
const assert = require('node:assert/strict');
const {chromium}=require('playwright');
const fs=require('node:fs');
test('内容脚本回复启动确认，验证码时暂停，不点击沟通', {timeout:15000}, async () => {
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try {
    const page=await browser.newPage();
    await page.route('https://www.zhipin.com/**', route=>route.fulfill({body:'<html><body></body></html>',contentType:'text/html'}));
    await page.goto('https://www.zhipin.com/web/geek/jobs');
    await page.setContent('<div class="verify-dialog">请完成安全验证</div><button onclick="window.clicked=true">立即沟通</button>');
    await page.evaluate(() => {
      window.messages=[];
      window.chrome={runtime:{onMessage:{addListener(fn){window.listener=fn;}},async sendMessage(m){messages.push(m);return {ok:true};}}};
      window.Storage={async getConfig(){return {keywords:['Java'],dailyLimit:80};},async getState(){return {todayCount:0};}};
    });
    await page.addScriptTag({content:fs.readFileSync('content.js','utf8')});
    const reply=await page.evaluate(()=>new Promise(resolve=>{
      listener({type:'START_BATCH',runId:'test'},{},resolve);
      setTimeout(()=>resolve({status:'missing'}),1000);
    }));
    assert.equal(reply.status,'ok');
    await page.waitForFunction(()=>messages.some(m=>m.type==='PAUSE'),{timeout:5000});
    assert.equal(await page.evaluate(()=>Boolean(window.clicked)),false);
    assert.equal(await page.evaluate(()=>messages.find(m=>m.type==='PAUSE').runId),'test');
  } finally {await browser.close();}
});
for (const success of [true,false]) {
  test(`页面${success?'确认成功':'结果不明确'}时上报正确状态且使用职位 ID`, {timeout:20000}, async () => {
    const browser=await chromium.launch({channel:'msedge',headless:true});
    try {
      const page=await browser.newPage();
      await page.route('https://www.zhipin.com/**',route=>route.fulfill({body:'<html><body></body></html>',contentType:'text/html'}));
      await page.goto('https://www.zhipin.com/web/geek/jobs');
      await page.setContent(`<div class="job-card-box"><a href="/job_detail/abc123.html"><span class="job-name">Java后端开发</span></a><span class="company-name">测试科技</span></div><div class="job-detail"><h2>Java后端开发</h2><span class="company-name">测试科技</span><button id="greet">立即沟通</button></div>`);
      await page.evaluate(success=>{
        window.messages=[];
        document.querySelector('#greet').onclick=()=>{ if(success) document.querySelector('#greet').textContent='继续沟通'; };
        window.chrome={storage:{local:{async get(){return {records:{}};}}},runtime:{onMessage:{addListener(fn){window.listener=fn;}},async sendMessage(m){messages.push(m);return {ok:true};}}};
        window.Storage={async getConfig(){return {keywords:['Java'],dailyLimit:80,excludeKeywords:[],greetingMessages:['你好'],intervalMin:18,intervalMax:35};}};
      },success);
      // Avoid following fixture links; real cards use an in-page panel.
      await page.evaluate(()=>document.querySelector('.job-card-box').addEventListener('click',e=>e.preventDefault()));
      await page.addScriptTag({content:fs.readFileSync('content.js','utf8')});
      await page.evaluate(()=>listener({type:'START_BATCH',runId:'test'},{},()=>{}));
      await page.waitForFunction(()=>messages.some(m=>m.type==='JOB_RESULT'),null,{timeout:15000});
      const result=await page.evaluate(()=>messages.find(m=>m.type==='JOB_RESULT'));
      assert.equal(result.status,success?'confirmed':'unknown');
      assert.equal(result.key,'job:abc123');
      await page.evaluate(()=>listener({type:'STOP_BATCH',runId:'test'},{},()=>{}));
    } finally {await browser.close();}
  });
}
