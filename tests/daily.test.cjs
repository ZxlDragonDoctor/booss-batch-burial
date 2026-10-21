const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
function daily() {
  const ctx = vm.createContext({ Date });
  if (fs.existsSync('daily.js')) vm.runInContext(fs.readFileSync('daily.js', 'utf8'), ctx);
  return vm.runInContext('typeof Daily === "undefined" ? {} : Daily', ctx);
}
test('中国日期在 UTC 16:00 跨日', () => {
  assert.equal(daily().dayKey?.(Date.parse('2026-10-21T16:01:00Z')), '2026-10-22');
});
test('每日 09:30 使用北京时间，下次执行不随主机时区变化', () => {
  assert.equal(daily().nextRun?.('09:30', Date.parse('2026-10-22T01:31:00Z')), Date.parse('2026-10-23T01:30:00Z'));
});
test('到点补执行但不重复启动，不覆盖人工暂停或运行中的任务', () => {
  const d = daily(), config = { scheduleEnabled: true, scheduleTime: '09:30' };
  const now = Date.parse('2026-10-22T02:00:00Z');
  assert.equal(d.shouldRun?.(config, {}, now), true);
  for (const s of [{ lastScheduledDate: '2026-10-22' }, { pausedOnCaptcha: true }, { isRunning: true }]) {
    assert.equal(d.shouldRun(config, s, now), false);
  }
  assert.equal(d.shouldRun(config, {}, Date.parse('2026-10-22T01:00:00Z')), false);
});
test('错误时间被拒绝', () => {
  assert.throws(() => daily().nextRun('25:99', Date.now()), /时间/);
});
