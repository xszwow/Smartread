# SmartRead 功能测试矩阵

更新时间：2026-05-18

这份矩阵从当前代码入口、API 路由、桌面/移动打包脚本和最新测试产物反推功能面。它不是替代测试命令，而是说明每个交付功能应由哪类证据证明。

## 覆盖原则

- 单机桌面版必须验证真实安装路径，不只验证 `release/win-unpacked`。
- 移动端必须验证 390x844 首屏、状态自适应磁贴、功能页返回和无横向滚动。
- Android/iOS 移动版必须是 Capacitor 内嵌静态资源的 standalone 形态，不依赖外部 Web Server 才能打开主页和本地阅读。
- 在线书源、AI、邮箱登录属于联网能力；本地导入、书架、阅读器、设置入口必须在单机/移动壳里可用。
- 证书风险分为本机开发信任和公开分发信任。当前 Windows/Android 是开发证书可验证；公开分发仍需要正式代码签名/商店签名链。

## 功能面

| 功能 | 代码入口 | 自动证据 | 状态 |
| --- | --- | --- | --- |
| 健康检查 | `server/app.ts` `/api/health` | `release:audit` 检查桌面启动使用 `/api/health`；桌面 smoke server log | 已验证 |
| 邮箱验证码登录 | `server/routes/auth-routes.ts` | `npm test` 覆盖发送、校验、冷却、过期、次数限制 | 已验证 |
| 桌面本机自动登录 | `server/routes/auth-routes.ts` + `desktop/main.cjs` | `desktop:smoke:packaged`、`desktop:smoke:installed` 均要求不出现邮箱验证码登录页 | 已验证 |
| 用户隔离 | `server/routes/books-routes.ts` | `npm test` 覆盖跨用户访问书籍返回 404 | 已验证 |
| 本地导入入口 | `js/bookshelf.js` / `index.html` | 桌面 smoke 真实导入 TXT；移动 e2e 覆盖导入功能页 | 已验证 |
| 书架列表 | `js/bookshelf.js` / `/api/books` | 移动 e2e 覆盖空书架、有书无记录、有最近阅读；桌面 smoke 覆盖导入后出现书卡 | 已验证 |
| 阅读器打开 | `js/reader.js` | 桌面 smoke 打开导入 TXT 并检查正文；移动 e2e 覆盖继续阅读进入 reader | 已验证 |
| 进度保存 | `/api/books/:id/progress` | `npm test` 覆盖进度接口；移动 e2e 用最近阅读状态验证主磁贴 | 已验证 |
| 移动 Metro 首页 | `js/bookshelf.js` + `css/bookshelf.css` | `test:e2e:mobile-empty-shelf` 覆盖无书、有书无记录、有最近记录三种主行动 | 已验证 |
| 移动功能页返回 | `js/bookshelf.js` | 移动 e2e 覆盖导入、在线、账号、书架页进入后主页隐藏并有返回入口 | 已验证 |
| AI 设置入口 | `js/ai-config.js` / `server/routes/ai-routes.ts` | 移动 e2e 覆盖设置弹窗入口；`npm test` 覆盖 AI config 和 chat mock | 已验证 |
| AI 聊天接口 | `server/routes/ai-routes.ts` | `npm test` 覆盖未配置 409、配置后非流式/流式 mock 响应 | 已验证 |
| Z-Library 绑定/换绑/解绑 | `server/routes/zlib-routes.ts` + `js/bookshelf.js` | `npm test` 覆盖绑定、失败超时、默认镜像；移动 e2e 覆盖未绑定/已绑定 UI 和“换绑 Z-Library”入口 | 已验证 |
| Z-Library 搜索分页/格式筛选 | `server/routes/zlib-routes.ts` | `npm test` 覆盖 page 1/2/3、format；移动 e2e 检查请求参数和格式 chip | 已验证 |
| Z-Library 下载任务 | `/api/zlib/download` `/api/downloads/:jobId` | `npm test` 覆盖下载 job 保存到书架 | 已验证 |
| Clash/mihomo 代理优选 | `server/zlib-clash-controller.ts` | `npm test` 覆盖日本优选代理选择；生产代理配置不入仓库 | 已验证为可选能力 |
| Windows 启动非白屏 | `desktop/main.cjs` | `desktop:smoke:packaged` 和 `desktop:smoke:installed` 保存 `startup.png` | 已验证 |
| Windows 打包/安装签名 | `scripts/build-windows-dev-signed.ps1` | `release:audit` 检查 installer、unpacked exe 签名 `Valid` | 当前机器已验证 |
| Windows 生产签名路径 | `scripts/build-windows-production-signed.ps1` / `scripts/sign-windows-artifacts.ps1 -Production` | `production-signing:check` 和生产脚本拒绝开发/自签证书 | 已接入，缺真实证书 |
| Android standalone 资源 | `scripts/prepare-mobile-web.cjs` / `android/app/src/main/assets/public` | `release:audit` 检查 Android embedded `native-config.js` standalone | 已验证 |
| Android APK 签名 | `scripts/build-android.cjs` | `release:audit` 调 `apksigner verify` 检查 release APK | 开发 keystore 已验证 |
| Android 生产 keystore 配置 | `android/app/build.gradle` | 支持 `ANDROID_KEYSTORE_PROPERTIES` 或 `ANDROID_STORE_FILE` 等环境变量；`production-signing:check` 拒绝 dev keystore | 已接入，缺真实 keystore |
| Android AAB 分发产物 | `scripts/build-android.cjs bundle` | `npm run android:build:bundle` 生成 `app-release.aab`；正式分发仍需 Play App Signing/生产 keystore | 构建路径已接入 |
| iOS standalone 资源 | `ios/App/App/public` | `release:audit` 检查 iOS embedded `native-config.js` standalone 和 Xcode 工程 | 工程已验证 |
| iOS signed IPA | `scripts/build-ios-release.sh` | Windows 只能做脚本语法检查；真实签名需要 macOS/Xcode/Apple Developer | 当前环境未完成 |

## 必跑命令

```powershell
npm run build
npm test
npm run desktop:smoke
npm run desktop:pack:win:dev-signed
npm run desktop:smoke:packaged
npm run desktop:smoke:installed
npm run test:e2e:mobile-empty-shelf
npm run functional:audit
npm run native:standalone:audit
npm run workspace:clean:audit
npm run packaging:check
npm run production-signing:check
npm run distribution:risk:audit
npm run release:audit
npm run release:readiness
```

`npm run signing:check` 用于查看签名环境；在 Windows 上缺少 iOS signing 是预期缺口，不应被解释为 iOS 已交付。

`npm run production-signing:check` 会拒绝开发证书/开发 keystore，并要求 iOS signed `.ipa`，用于判断是否进入“普通用户低风险分发”状态。

`npm run distribution:risk:audit` 是正式分发门禁。当前开发签名环境下会失败；只有 Windows/Android/iOS 都具备正式信任链或受管分发方案时才应通过。

`npm run release:readiness` 会生成 `docs/release-readiness-current.md`，把当前产物、截图/e2e 证据、硬验证命令和正式分发阻塞项汇总到一份交付状态报告中。

## 当前硬缺口

- iOS signed `.ipa` 不能在当前 Windows 主机上生成。需要 macOS、Xcode、Apple Developer Team ID 和 provisioning profile 后运行 `npm run ios:build:release`。
- Windows 当前证书是本机开发证书，当前设备信任链有效。公开分发要降低 SmartScreen 风险，需要 OV/EV 代码签名证书或 Microsoft Store。
- Android 当前 release APK 是本地开发 keystore 签名。面向普通用户分发建议使用 Play App Signing、企业签名或受管设备策略。

## Standalone 移动壳审计

`npm run native:standalone:audit` 会检查：

- 根 `capacitor.config.json`、Android/iOS 嵌入配置都没有 `server.url`。
- `mobile-www`、Android public、iOS public 三份 `native-config.js` 都是 `apiBaseUrl: ""`、`standalone: true`、`appMode: "mobile"`。
- 三份 `index.html` 都先加载 `native-config.js`，再加载 `js/api.js`。
- Android/iOS 嵌入的 public 资源与 `mobile-www` 源文件 hash 一致。
