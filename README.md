# SmartRead

SmartRead 是一个本地优先的 AI 阅读应用。当前工程支持：

- Windows 桌面版：Electron 打包，启动本机 `127.0.0.1` 阅读服务，默认本机账号，不依赖外部 SmartRead 服务器。
- Android App：Capacitor 打包，默认手机单机模式，书籍和进度保存在设备本地。
- iOS 项目：Capacitor iOS 工程已生成；签名和 `.ipa` 需要 macOS、Xcode 和 Apple Developer Team。
- Web Server：可选部署形态，用于多设备账号、服务端 Z-Library 下载和统一 AI 代理。

## 当前交付产物

- Windows 安装器：`release/SmartRead Setup 0.1.0.exe`
- Windows 免安装目录：`release/win-unpacked/SmartRead.exe`
- Android Debug APK：`android/app/build/outputs/apk/debug/app-debug.apk`
- Android Release APK：`android/app/build/outputs/apk/release/app-release.apk`
- Android Release AAB：`android/app/build/outputs/bundle/release/app-release.aab`（用于 Play/受管分发路径）
- iOS 工程：`ios/`
- 验证截图：`test-artifacts/`

## 使用方式

### Windows

直接运行：

```powershell
.\release\win-unpacked\SmartRead.exe
```

或运行安装器：

```powershell
.\release\"SmartRead Setup 0.1.0.exe"
```

桌面版会自动启动本地服务和本机书架账号，不需要邮箱验证码。用户数据默认在系统 AppData 的 SmartRead 目录下；自动化测试可用 `SMARTREAD_DATA_DIR` 指定临时数据目录，用 `SMARTREAD_USER_DATA_DIR` 隔离 Electron profile。

如果从开始菜单或旧快捷方式启动后仍然闪退，先确认它指向的是最新安装目录。重新运行 `release/SmartRead Setup 0.1.0.exe` 后，安装目录应更新为最新时间；免安装调试时以 `release/win-unpacked/SmartRead.exe` 为准。桌面服务日志在 `%APPDATA%\SmartRead\smartread-server.log`。

### Android

安装 release APK：

```powershell
adb install -r .\android\app\build\outputs\apk\release\app-release.apk
```

Android 默认是单机模式：

- 不连接外部 SmartRead 服务器。
- 当前 APK 使用 `android-native-backend`：认证态、书架、Z-Library 绑定/搜索/下载、AI 配置和 AI chat 都通过 Android 原生 Capacitor 插件在手机本机执行。
- 本地导入 EPUB / PDF / TXT。
- 书籍与进度保存在设备本地。
- 在线书源可绑定 Z-Library 后在 APK 内搜索和触发下载；外部镜像可用性仍取决于 Z-Library 当前服务状态。
- 在线下载的大体积 PDF 直接通过 Android 本机文件路径读取，避免把漫画/扫描版 PDF 通过 JS bridge 转 base64 导致卡顿或打不开。
- PDF 阅读器支持读取文件内置 outline/bookmarks 作为目录；扫描漫画 PDF 如果文件本身没有书签，则显示暂无目录。
- AI 可使用用户自己配置的 OpenAI-compatible API 地址和 Key 直连，支持 HTTP/HTTPS chat completions。
- AI 解读、聊天面板、当前句子高亮朗读、上一句/下一句、停止朗读和字幕大/小/关闭在 Android WebView 中优先走 Android 原生 `TextToSpeech`。
- 移动端 AI 解读生成后默认显示可滚动的全文大字幕遮罩，但不会自动开始朗读；全文遮罩、朗读播放器和底部阅读工具栏使用固定底部控件栈布局，遮罩滚动区域截止在播放器上方，不与底部控件重叠；点击“听解读”或点击任意句子后，才从目标句启动朗读并高亮当前句。
- 语音输入入口优先走 Android 系统语音识别，APK 包含 `RECORD_AUDIO` 权限。
- 移动阅读主页是固定矩形网格：继续阅读占左侧两行，我的书架在右上，导入横跨右中两格，在线找书在左下，账号和 AI 在右下并排。

### iOS

Windows 下只能生成和同步 Capacitor iOS 工程：

```powershell
npm run mobile:sync
```

要产出可安装 `.ipa`，需要在 macOS 上用 Xcode 配置 Apple Developer Team、证书和 provisioning profile，再通过 TestFlight、App Store 或企业/MDM 分发。

macOS 上的签名导出命令：

```bash
export IOS_DEVELOPMENT_TEAM=YOUR_TEAM_ID
export IOS_EXPORT_METHOD=development
npm run ios:build:release
```

导出产物会放在 `release/ios/`。`IOS_EXPORT_METHOD` 可按分发方式改为 `app-store-connect`、`ad-hoc`、`enterprise` 或 `development`，前提是 Apple 账号和 provisioning 已配置好。

## 开发命令

脚本已显式使用仓库自带的 Node。正常情况下直接运行 npm 脚本即可；如果系统 PATH 干扰了 `npm`，用仓库自带的 npm：

```powershell
.\tools\node-v24.15.0-win-x64\npm.cmd run build
```

常用命令：

```powershell
npm run build
npm test
npm run desktop:smoke
npm run desktop:pack:win:dev-signed
npm run desktop:pack:win:production-signed
npm run desktop:smoke:packaged
npm run desktop:smoke:installed
npm run functional:audit
npm run native:standalone:audit
npm run workspace:clean:audit
npm run mobile:sync
npm run android:build:debug
npm run android:build:release
npm run android:build:bundle
npm run ios:build:release   # macOS + Xcode only
npm run packaging:check
npm run signing:check
npm run production-signing:check
npm run distribution:risk:audit   # 正式分发门禁；当前开发证书环境会失败
npm run release:audit
npm run release:readiness
```

## 部署形态

### 单机桌面版

- Electron 启动本地 Fastify 服务。
- 服务监听 `127.0.0.1` 随机端口。
- `SMARTREAD_DEPLOYMENT=desktop` 时 `/api/auth/me` 会自动创建本机账号。
- 打包时必须解包 `dist/server`、`node_modules`、`index.html`、`index.css`、`css`、`js`，否则安装版会找不到后端依赖、出现 404，或隐藏遮罩挡点击。
- 桌面壳启动健康检查使用 `/api/health`。不要用会探测外网的 `/api/auth/config` 当启动检查，否则离线或 Z-Library 慢时窗口会超时。
- 打包版 smoke 会把应用复制到临时目录，并通过 `SMARTREAD_USER_DATA_DIR` 和 `SMARTREAD_DATA_DIR` 隔离测试数据，避免复用真实 AppData/IndexedDB 导致误判。

### 手机单机版

`npm run mobile:prepare` 默认写入：

```js
window.SmartReadNativeConfig = {
  apiBaseUrl: "",
  standalone: true,
  appMode: "mobile"
};
```

如需改成连接部署服务器：

```powershell
$env:SMARTREAD_NATIVE_STANDALONE='0'
$env:SMARTREAD_NATIVE_API_BASE_URL='https://your-api.example.com'
npm run mobile:sync
```

### Web Server

Web Server 是可选形态。需要配置 HTTPS、cookie、邮箱验证码、AI 代理和 Z-Library 出口策略。不要把私有代理池、节点密码、生产证书或 API Key 写进仓库。

## 签名和设备风险

- Windows 当前产物已用本机开发代码签名证书签名，当前设备已导入并信任该证书，`npm run release:audit` 显示 installer 和 unpacked exe 均为 `Valid`。本机开发证书 thumbprint 是 `6BDEF7FF00928BD38F25BF2177DD3F1F7B6F8CF9`。推荐用 `npm run desktop:pack:win:dev-signed` 重打包：它会先签 `win-unpacked` 内的 exe，再用已签 payload 生成安装器，最后签安装器本身。换到新设备后，如果 Windows 签名链显示 `UnknownError`，用管理员 PowerShell 运行 `npm run windows:trust-dev-cert` 后再审计。公开分发仍需要 OV/EV 代码签名证书或 Microsoft Store 才能更稳定减少 SmartScreen 风险。
- Windows 正式签名路径是 `npm run desktop:pack:win:production-signed`。它要求 `WINDOWS_SIGNING_CERT_THUMBPRINT` 指向证书库中的非开发代码签名证书，或 `WINDOWS_SIGNING_CERT_PATH`/`CSC_LINK` 指向 `.pfx`，并可用 `WINDOWS_SIGNING_CERT_PASSWORD`/`CSC_KEY_PASSWORD`、`WINDOWS_SIGNING_TIMESTAMP_URL` 配置密码和时间戳。不满足时会失败，不会自动降级成开发证书。
- Android release APK/AAB 当前使用本地开发 keystore 签名，`apksigner verify` 和 AAB `jarsigner -verify` 通过。生产签名可用 `ANDROID_KEYSTORE_PROPERTIES` 指向仓库外的 properties 文件，或设置 `ANDROID_STORE_FILE`、`ANDROID_STORE_PASSWORD`、`ANDROID_KEY_ALIAS`、`ANDROID_KEY_PASSWORD`。面向普通用户建议使用 Play App Signing、企业分发或受管设备分发。
- `npm run production-signing:check` 专门检查正式分发签名环境；当前会失败，因为本机没有非开发 Windows 代码签名证书、Android 生产 keystore/Play 签名证明和 iOS signed `.ipa`。
- iOS 不能安装未签名 App。需要 Apple Developer Program 和合法 provisioning。
- `npm run distribution:risk:audit` 是正式分发风险门禁。当前会失败，因为 Windows/Android 使用开发签名且 iOS signed `.ipa` 未产出；在换成正式签名链/商店或受管分发后应变绿。

## 已验证

最近一次验证：

- TypeScript build 通过。
- Vitest 后端测试 19 个通过。
- Android debug APK 构建成功并安装到真机 `d66fdb58`。
- Android native backend audit 通过：APK 无外部 `server.url`，内嵌 public 资源与 `mobile-www` 一致，Android 插件注册并覆盖 zlib、AI、TTS 和 speech 方法。
- Android APK 签名校验通过：APK Signature Scheme v2 为 `true`；包内包含 `INTERNET` 和 `RECORD_AUDIO` 权限。
- Android 真机 AI 验证通过：`SmartReadAPI.aiChat`、`AIService.chat`、聊天面板和 AI 解读均返回有效文本。
- Android 真机 TTS 验证通过：`SmartReadAPI.ttsSpeak` 2.5 秒后仍在播放等待状态，`ttsStatus.ready=true`；前端长句朗读中 `TTS.speaking=true`，当前句子高亮存在，下一句后仍保持朗读。
- Android 真机字幕验证通过：大字幕容器和文本宽度未超过视口，页面没有横向滚动。
- 移动端 AI 解读 DOM 验证通过：生成结果后全文遮罩和播放器显示、`TTS.speaking=false`；点击第 3 句后 `TTS.source=ai`、`TTS.currentSentence=2`，遮罩内第 3 句高亮。
- 移动端 AI 解读布局回归通过：全文遮罩底边到播放器 44px，播放器到底部工具栏 28px，滚动到末尾时最后一句仍停在播放器上方，不与底部控件重叠。
- Android 真机移动主页验证通过：导入横跨原导入和 AI 两格，AI 下移到账号右侧；页面保持矩形网格且无横向溢出。
- 桌面服务 smoke 通过。
- Windows 打包版 smoke 通过：启动页非白屏截图、自动本机登录、TXT 导入、进入阅读器。
- Windows 安装版 smoke 通过：已安装 `SmartRead.exe` 签名有效、启动页非白屏截图、自动本机登录、TXT 导入、进入阅读器。
- 移动端 390x844/桌面回归截图 e2e 6 个场景通过。
- `npm run functional:audit` 通过：检查最新移动 e2e、打包版/安装版 smoke 截图、server log 和功能测试矩阵证据。
- `npm run native:standalone:audit` 通过：Android/iOS 内嵌 public 资源与 `mobile-www` 一致，且没有外部 `server.url`。
- `npm run workspace:clean:audit` 通过：没有旧失败截图、旧移动 e2e run 或 SmartRead 临时目录残留。
- Android debug/release APK 构建成功。
- Android release AAB 构建路径已接入 `npm run android:build:bundle`，用于后续 Play App Signing 或受管分发。
- Android release APK 签名校验通过。
- Capacitor iOS 工程同步成功。
- `npm run release:audit` 检查通过：Windows 签名链 `Valid`，桌面包内包含 userData 隔离、启动页、`/api/health` 启动检查和加载失败重试，Android release APK 签名校验通过，iOS 工程产物存在。iOS signed `.ipa` 需要在 macOS/Xcode/Apple 签名环境完成。
- `npm run release:readiness` 已生成当前交付状态报告：本机/开发验证通过，公开低风险分发仍被正式证书和 iOS signed `.ipa` 缺口阻塞。
- `npm run distribution:risk:audit` 已运行并按预期失败：当前工件适合本机/开发验证，不满足公开低风险分发。

详细报告见 `docs/verification-report.md`。当前交付状态见 `docs/release-readiness-current.md`。功能覆盖矩阵见 `docs/functional-test-matrix.md`。

## 维护注意

- 改前端入口文件后，确认 `package.json` 的 `build.files` 和 `build.asarUnpack` 同步包含新增资源。
- 改移动端逻辑后，运行 `npm run mobile:sync` 并重建 Android。
- 改登录、书籍、AI、Z-Library API 后，运行 `npm test`。
- 改移动首页 UI 后，运行 `npm run test:e2e:mobile-empty-shelf`。该脚本会先编译 TypeScript；如果 `http://127.0.0.1:4173` 没有现成服务，会自动启动临时本地服务并在测试结束后关闭。
- 打包后必须运行 `npm run desktop:pack:win:dev-signed`、`npm run desktop:smoke:packaged` 和 `npm run desktop:smoke:installed`。两条 smoke 都会保存 `startup.png` 和 `open.png`，分别证明启动早期不是白屏、导入后能进入阅读器；安装版验证 `%LOCALAPPDATA%\Programs\SmartRead\SmartRead.exe` 这个真实安装路径。
- 交付前运行 `npm run functional:audit`，确认最新截图/e2e/smoke 产物覆盖关键功能面。
- 交付前运行 `npm run native:standalone:audit`，确认 Android/iOS 壳内资源和 `mobile-www` 同步，且不依赖外部 Web Server。
- 交付前运行 `npm run workspace:clean:audit`。如发现旧失败产物，确认不再需要后运行 `node scripts/workspace-clean-audit.cjs --fix` 清理。
- 交付前运行 `npm run release:audit`。如果 Windows 签名信任失败，要导入开发证书或换正式证书后再交付。
- 交付前运行 `npm run release:readiness`。它会汇总产物、截图、审计结果和正式分发阻塞项，不能只看单个绿色测试。
- 面向普通用户公开分发前运行 `npm run distribution:risk:audit`，必须全部为 `ok` 后再发布。
- 如果测试安装版，不要只看 `release/win-unpacked`；要重新运行安装器，确保 `%LOCALAPPDATA%\Programs\SmartRead\SmartRead.exe` 时间和新包一致。
