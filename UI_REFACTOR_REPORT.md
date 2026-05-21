# 表哥智读 UI 重构报告

## 参考来源

- 参考项目：`C:\Users\lihuili\Desktop\biaoge - 副本\数据分析助手网页版带后台grok`
- 参考文件：`logo.png`、`css/base.css`、`css/layout.css`、`css/components/buttons.css`、`css/components/messages.css`、`css/components/file-upload.css`、`css/components/overlay.css`、`css/responsive.css`、`chat.html`
- 当前项目：`C:\Users\lihuili\Desktop\reading-source-20260515-101237`

## 角色协作记录

- 色彩设计师：按 `/goal` 要求创建色彩分析角色，重点复核参考项目的红色品牌色、白底卡片、低饱和边框、暖色背景和文字层级。
- 按钮和控件分析师 UI：按 `/goal` 要求创建控件分析角色，重点覆盖按钮、输入框、选择器、弹窗、导航、卡片、空状态、加载态和错误态。
- 审计师：按 `/goal` 要求创建审计角色，重点检查主题切换、护眼模式、夜间模式、响应式、可访问性、静态资源白名单和业务逻辑耦合。
- 内测用户：按 `/goal` 要求创建内测角色，重点制定桌面端、移动端、logo 加载、登录页、主题切换和主要按钮验证路径。
- 说明：`spawn_agents_on_csv` 成功创建 4 个角色波次，但 worker 未按工具契约回写 `report_agent_job_result`，因此结构化结果被工具标记失败。总控保留该失败记录，并按同一角色清单完成了直接代码与浏览器复核。

## 改动范围

- 品牌资源：复制参考项目 `logo.png` 为 `images/biaoge-logo.png`，并用于 favicon、顶部品牌和登录卡片。
- 入口页面：将页面标题、描述、顶部品牌、登录卡和 AI 输入提示调整为“表哥智读”。
- 设计令牌：在 `index.css` 中重构浅色主题为红色暖调品牌体系，新增 `--brand-primary`、`--accent-gradient`、`--surface-control`、`--border-strong`、`--focus-ring` 等可复用变量。
- 书架页：统一 header、登录卡、统计卡、书籍卡、云端/在线书源卡片、搜索框、空状态和移动端 dashboard 的视觉层级。
- 阅读器：统一侧边栏、右侧 AI 面板、弹窗、移动工具栏、目录、悬浮导航和焦点态。
- 对话和 AI 面板：统一用户气泡、AI avatar、输入胶囊、建议按钮、AI 讲书按钮、加载态和错误态。
- 划词弹窗：统一背景、边框、阴影、hover 和 focus 状态。
- 移动包：更新 `scripts/prepare-mobile-web.cjs`，让 `mobile-www` 同步复制 `images/`。
- 静态服务：更新 `server/app.ts`，允许服务 `images/` 静态资源，保证 Web 端 logo 可加载。

## 色彩方案

- 浅色品牌主色：`#e31b23`
- 浅色品牌深红：`#8f1118`
- 浅色暖背景：`#fff7f4`
- 浅色卡片面：`#fffdf9`、`rgba(255,255,255,0.92)`
- 强调渐变：`linear-gradient(135deg, #e31b23 0%, #c9151c 100%)`
- 成功色：`#10b981`
- 错误色：`#dc2626`
- 夜间模式保护：`theme-dark` 显式恢复蓝色强调 `#0a84ff`，阅读底色保持 `#101014` / `#1c1c1e`。
- 护眼模式保护：`theme-sepia` 保持棕色强调 `#8a5a1f`，阅读底色保持 `#dfca9a` / `#f3e0b4`。

## 组件调整

- 按钮：统一圆角、渐变主按钮、禁用态、点击态、hover lift 和 `focus-visible`。
- 输入框/选择器：统一 `surface-control`、强边框、焦点环和移动端触控高度。
- 卡片：统一玻璃卡片、暖色阴影和边框层级。
- 弹窗：统一弹窗卡片、遮罩、主题按钮和控件焦点态。
- 导航：统一侧栏按钮、激活态、移动工具栏和更多菜单。
- 空状态：登录空状态改用表哥 logo，增强标题层级和红色品牌背景。
- 加载态：进度条、AI loading orbit、发送按钮 loading 使用同一强调体系。
- 错误态：保留红色错误语义，同时统一边框、阴影和卡片结构。

## 护眼/夜间验证

- `App.setTheme('theme-sepia')` 后，`body.className = "theme-sepia"`。
- 护眼模式验证值：`--accent = #8a5a1f`，`--reader-bg = #dfca9a`，`--reader-page-bg = #f3e0b4`。
- EPUB 护眼同步值：`bg = #f3e0b4`，`text = #372713`，`mediaFilter = sepia(0.62) saturate(0.72) brightness(0.96) contrast(0.96)`。
- `App.setTheme('theme-dark')` 后，`body.className = "theme-dark"`。
- 夜间模式验证值：`--accent = #0a84ff`，`--reader-bg = #101014`，`--reader-page-bg = #1c1c1e`。
- EPUB 夜间同步值：`bg = #1c1c1e`，`text = #f5f5f7`，`mediaFilter = invert(1) hue-rotate(180deg) contrast(0.92) brightness(0.88)`。
- `App.setTheme('')` 后，浅色模式回到表哥红品牌体系：`--accent = #e31b23`，`--reader-page-bg = #fffdf9`。

## 内测问题和修复记录

- 问题：头部替换了品牌，但登录卡仍使用旧蓝色书本图标。
- 修复：`Bookshelf.authHTML()` 中的 `login-mark` 改为 `images/biaoge-logo.png`。
- 问题：新增图片路径最初不在 Fastify 静态白名单内。
- 修复：`server/app.ts` 的 `isAllowedStaticPath()` 增加 `images/`。
- 问题：移动端构建脚本不会复制 logo 图片。
- 修复：`scripts/prepare-mobile-web.cjs` 增加 `copyDir("images")`。
- 问题：浅色背景覆盖层会影响夜间和护眼背景。
- 修复：为 `body.theme-dark`、`body.theme-sepia`、`.theme-dark #bookshelf-view.active`、`.theme-sepia #bookshelf-view.active` 增加专属背景覆盖。
- 问题：夜间模式主 `--accent` 曾继承浅色红色品牌色。
- 修复：`theme-dark` 显式设置 `--accent: #0a84ff`、`--accent-soft` 和 `--accent-glow`。

## 验证结果

- `.\tools\node-v24.15.0-win-x64\node.exe scripts\prepare-mobile-web.cjs`：通过。
- `.\tools\node-v24.15.0-win-x64\npm.cmd run build`：通过。
- `.\tools\node-v24.15.0-win-x64\npm.cmd test`：通过，`1` 个测试文件、`19` 个测试全部通过。
- 本地服务：`http://127.0.0.1:4173/api/health` 返回 `{"ok":true,"deploymentMode":"web"}`。
- 内置浏览器桌面验证：标题、顶部品牌、favicon/logo、登录卡 logo 均正常加载。
- 内置浏览器移动验证：`390x844` 视口下 logo 和登录卡可见，页面横向溢出为 `hidden`。
- Playwright 主题验证：浅色、夜间、护眼三套主题变量和 `Reader.currentThemePalette()` 均符合预期。
- 截图产物：`test-artifacts/ui-refactor-playwright-desktop.png`、`test-artifacts/ui-refactor-playwright-mobile.png`。
