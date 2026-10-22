const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {chromium} = require('playwright');

async function fixture(body, run) {
  const browser = await chromium.launch({channel:'msedge',headless:true});
  try {
    const page = await browser.newPage();
    await page.setContent(body);
    await page.evaluate(() => {
      window.messages=[];
      window.chrome={runtime:{onMessage:{addListener(fn){window.listener=fn;}},async sendMessage(m){messages.push(m);return {ok:m.type!=='OPEN_JOB_DETAIL'};}},storage:{local:{async get(){return {records:{}};}}}};
      window.Storage={async getConfig(){return {keywords:['Java','Agent'],excludeKeywords:[],blacklist:[],dailyLimit:80,greetingMessages:['你好'],intervalMin:18,intervalMax:35};}};
      document.addEventListener('click',event=>{if(event.target.closest('a[href*="/job_detail/"]'))event.preventDefault();});
    });
    await page.addScriptTag({content:fs.readFileSync('content.js','utf8')});
    await run(page);
  } finally {await browser.close();}
}

test('嵌套标题去掉薪资且点击职位链接事件，按 ID 识别详情按钮', {timeout:18000}, async()=>{
  await fixture(`<div class="job-card-wrapper"><a class="job-card-left" href="/job_detail/real123.html">
    <div class="job-name"><span class="job-title">Java 开发工程师（AI工程方向）</span><span class="salary">-K</span></div>
    </a><a class="company-name">测试公司</a></div><div id="detail"></div>`,async page=>{
    await page.evaluate(()=>{
      document.querySelector('.job-card-left').onclick=event=>{
        event.preventDefault();
        document.querySelector('#detail').innerHTML='<div class="job-detail-container"><div class="job-banner" data-job-id="real123"><h1>Java 开发工程师（AI工程方向）</h1><a class="btn-startchat" href="javascript:void(0)">立即沟通</a></div></div>';
        document.querySelector('.btn-startchat').onclick=event=>{event.target.textContent='继续沟通';};
      };
    });
    await page.evaluate(()=>listener({type:'START_BATCH',runId:'test'},{},()=>{}));
    await page.waitForFunction(()=>messages.some(m=>m.type==='RESERVE_JOB'),null,{timeout:9000});
    const job=await page.evaluate(()=>messages.find(m=>m.type==='RESERVE_JOB').job);
    assert.equal(job.title,'Java 开发工程师（AI工程方向）');
    assert.equal(job.key,'job:real123');
    await page.waitForFunction(()=>messages.some(m=>m.type==='JOB_RESULT'),null,{timeout:6000});
    assert.equal(await page.evaluate(()=>messages.find(m=>m.type==='JOB_RESULT').status),'confirmed');
    await page.evaluate(()=>listener({type:'STOP_BATCH',runId:'test'},{},()=>{}));
  });
});

test('只有不匹配职位的沟通按钮时绝不发送，连续结构失败会暂停', {timeout:18000}, async()=>{
  await fixture(`<div class="job-card-box"><a href="/job_detail/wanted.html"><span class="job-name">Agent开发工程师</span></a><span class="company-name">甲公司</span></div>
    <div class="job-detail"><h2>Java开发工程师</h2><span class="company-name">乙公司</span><button onclick="window.wrongClick=true">立即沟通</button></div>`,async page=>{
    await page.evaluate(()=>listener({type:'START_BATCH',runId:'test'},{},()=>{}));
    await page.waitForFunction(()=>messages.some(m=>m.type==='PAUSE'),null,{timeout:14000});
    assert.equal(await page.evaluate(()=>Boolean(window.wrongClick)),false);
    assert.equal(await page.evaluate(()=>messages.some(m=>m.type==='RESERVE_JOB')),false);
    const reason=await page.evaluate(()=>messages.find(m=>m.type==='PAUSE').reason);
    assert.match(reason,/详情|匹配|按钮/);
  });
});
