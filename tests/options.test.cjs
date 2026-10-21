const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('playwright');
test('配置页保存每日时间并保留既有筛选，错误 URL 不保存',async()=>{
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try {
    const page=await browser.newPage();
    await page.route('http://fixture/**',async route=>{
      const url=new URL(route.request().url());
      const file=path.join(process.cwd(),url.pathname);
      await route.fulfill({body:fs.readFileSync(file),contentType:file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html'});
    });
    await page.addInitScript(()=>{
      window.saved=null;
      window.chrome={runtime:{async sendMessage(){return {lastResult:'测试：今日确认沟通 2 次'};}},
        storage:{sync:{async get(){return {config:{keywords:['Java'],cities:['上海'],experience:['3-5年'],salaryMin:20,scheduleEnabled:true,scheduleTime:'09:30'}};},async set(data){window.saved=data.config;}},local:{async get(){return {records:{},state:{}};}}}};
    });
    await page.goto('http://fixture/options/options.html');
    await page.locator('#scheduleTime').fill('10:15');
    await page.locator('#saveBtn').click();
    await page.waitForFunction(()=>window.saved);
    assert.equal(await page.evaluate(()=>saved.scheduleTime),'10:15');
    assert.deepEqual(await page.evaluate(()=>saved.cities),['上海']);
    assert.deepEqual(await page.evaluate(()=>saved.experience),['3-5年']);
    await page.evaluate(()=>{window.saved=null;});
    await page.locator('#searchUrl').fill('https://evil.example/jobs');
    await page.locator('#saveBtn').click();
    assert.equal(await page.evaluate(()=>window.saved),null);
    await page.locator('#searchUrl').fill('https://www.zhipin.com/web/geek/jobs');
    await page.screenshot({path:'tests/options-preview.png',fullPage:true});
  } finally {await browser.close();}
});
