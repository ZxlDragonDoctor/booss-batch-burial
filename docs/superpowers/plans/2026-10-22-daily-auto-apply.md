# Daily auto apply implementation plan

**Goal:** 在现有扩展中实现北京时间每日运行和可核查的沟通记录。

**Architecture:** 后台串行管理任务和岗位状态，内容脚本只在被授权的标签页操作。调度和日期计算独立为纯函数，状态持久化到 local storage。

**Tech Stack:** Manifest V3, JavaScript, Node test runner, Playwright。

- [x] 添加 `tests/daily.test.cjs`，用 `node --test` 先验证缺少调度和日期功能时失败。
- [x] 添加 `daily.js`：`dayKey(now)`、`dueAt(time, now)`、`nextRun(time, now)`、`shouldRun(config,state,now)`；固定 Asia/Shanghai，不依赖主机时区。
- [x] 修改 `storage.js`：默认调度配置、中国日期、任务状态；由后台串行更新计数及岗位记录。
- [x] 修改 `background.js`：持久任务归属、启动确认、READY 恢复、单次 alarm 重建、每日自动启动幂等、暂停保留和错误通知。
- [x] 修改 `content.js`：确认 START_BATCH、限制停止后的动作、持久预登记和成功确认、验证码登录检测、岗位 ID 去重、黑名单。
- [x] 配置页加入调度和记录导出；修复保存表单丢失已有字段；弹窗读取后台状态。
- [x] 添加 Windows 浏览器启动任务安装脚本和操作说明。
- [x] 执行 Node 状态机测试、JS 语法检查、本地页面验证；仅报告真实通过的范围。


## 验证结果
2026-10-22：`npm test` 16/16 通过，含在全新临时 Edge 用户配置加载真实 MV3 扩展的完整测试（页面为本地模拟，不会向真实招聘方发送消息）。`npm run check` 与 `git diff --check` 通过。
Windows `BossHelperDailyBrowser` 已注册并处于 Ready，09:29 启动 Edge；扩展默认北京时间 09:30。
发布包：`dist/BOSS-helper-v2.1.0.zip`。用户仍需在个人 Edge 中重新加载扩展并完成 BOSS 登录；未验证真实账号投递结果。
