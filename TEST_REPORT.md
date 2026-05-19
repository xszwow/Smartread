# SmartRead Android APK 测试报告

生成时间：2026-05-19（Asia/Shanghai）

## APK 产物

- APK 路径：`C:\Users\lihuili\OneDrive\Desktop\reading-source-20260515-101237\android\app\build\outputs\apk\debug\app-debug.apk`
- APK 大小：4,947,292 bytes
- 更新时间：2026-05-19 18:38:25
- 包名：`com.smartread.app`
- 应用名：`SmartRead`
- `minSdkVersion`：24
- `targetSdkVersion`：36
- 启动 Activity：`com.smartread.app.MainActivity`
- 网络权限：`android.permission.INTERNET`
- 录音权限：`android.permission.RECORD_AUDIO`
- 签名验证：`apksigner verify --verbose` 通过，APK Signature Scheme v2 为 `true`
- 真机安装：`adb install -r android\app\build\outputs\apk\debug\app-debug.apk` 成功
- 真机设备：`d66fdb58`，`model:2410DPN6CC`，`product:haotian`

## 技术栈与构建识别

- 技术栈：静态 Web 前端 + Fastify/TypeScript Web 后端 + Electron 桌面壳 + Capacitor Android/iOS 工程。
- Web 启动命令：`npm run dev`
- Web 构建命令：`npm run build`
- 移动资源同步命令：`npm run mobile:sync`
- Android 构建命令：`npm run android:build:debug`
- Android 环境：项目内 `tools/jdk-21`、`tools/android-sdk`，包含 platform-tools、Android platform 36、build-tools。
- 本地测试配置：`.env.local`，已被 `.gitignore` 忽略；zlib 测试账号与 LLM API 配置只用于本地测试/接口配置，没有写死到业务源码。
- 当前 APK 模式：`android-native-backend`，Capacitor 没有配置 `server.url`，APK 不依赖外部 Node/Fastify 服务运行。

## 原生后端改造范围

- 新增 Android Capacitor 插件 `SmartReadBackendPlugin`，在 `MainActivity` 注册。
- APK 内原生实现：认证态、Z-Library 绑定/解绑、Z-Library 搜索、Z-Library 下载任务、本机书架、本机文件读取、阅读进度、删除书籍、AI 配置、AI chat 代理、Android TextToSpeech 朗读、Android 系统语音识别入口。
- 新增 `js/native-backend.js`，在 Android WebView 中将 `SmartReadAPI` 从 `/api/*` HTTP 客户端切换到 Capacitor 原生插件。
- `js/api.js` 改为可重绑定的全局 API，避免 Android WebView 继续调用原 Web 后端。
- `scripts/prepare-mobile-web.cjs` 默认生成 `nativeBackend: true`、`standalone: false`，并复制根级 `index.css`。
- 针对 Android WebView 首页发糊问题，`native-backend-runtime` 与 `native-standalone-runtime` 均禁用关键容器 `backdrop-filter`。

## 已测试页面与功能

- Web 主页 / 书架页：启动、空书架、统计区、导入入口、搜索入口、AI 状态入口。
- 云服务 / 账号区：Z-Library 登录态、绑定状态、换绑、取消换绑。
- 在线书源页：搜索框、格式筛选、分页按钮、搜索按钮、下载按钮。
- AI 设置：打开设置、填写 API URL、填写 API Key、填写模型、保存配置、关闭面板。
- 移动端主页：移动 tile 首页、继续阅读、书架、导入、在线找书、账号与 AI、返回上级。
- 移动端在线书源：搜索、全部/EPUB/PDF/TXT 格式筛选、换绑 Z-Library、取消换绑、下载按钮触发任务。
- 阅读器基础页：打开导入的 TXT、上一页、下一页、聊天面板、设置、主题、字体、笔记、图谱、目录、返回书架。
- Android WebView 资源：`mobile-www`、Android embedded public assets、`native-config.js`、Capacitor config、Native API bridge。
- AI / 字幕 / 朗读功能：AI chat、阅读器聊天面板、AI 解读、AI 朗读、当前句子高亮、上一句、下一句、停止朗读、字幕大/小/关闭切换、语音输入按钮状态。
- Android 原生后端静态覆盖：`config`、`me`、`login`、`requestEmailCode`、`verifyEmailCode`、`logout`、`bindZlib`、`unbindZlib`、`searchZlib`、`startZlibDownload`、`downloadJob`、`serverBooks`、`updateBookProgress`、`deleteServerBook`、`fetchBookFile`、`aiConfigStatus`、`saveAIConfig`、`aiChat`、`ttsStatus`、`ttsSpeak`、`ttsStop`、`recognizeSpeech`。

## 按钮 / 菜单 / 表单清单

- 桌面端按钮：AI API 已配置、保存配置、导入书籍、Z-Library 已绑定、换绑、取消换绑、搜索、下载、上一页、下一页、解绑、下载中。
- 移动端主页按钮：继续阅读、本地书架、导入、在线找书、账号与 AI、返回上一级。
- 移动端在线按钮：搜索、全部、EPUB、PDF、TXT、换绑 Z-Library、取消换绑、下载。
- 移动端账号/AI 按钮：管理设置、打开 AI 设置、保存设置、关闭设置面板、在线书源。
- 阅读器按钮：上一页、下一页、聊天面板、AI 解读、AI 朗读、上一句、下一句、字幕切换、语音输入、停止朗读、设置、主题深色、主题浅色、字体 A-、字体 A+、笔记、图谱、目录、返回书架。
- 表单：AI API URL、AI API Key、AI model、Z-Library 搜索关键词、Z-Library 邮箱、Z-Library 密码。
- 链接：Z-Library 注册链接在未绑定态保留；本轮登录态主流程未发现必须点击的站内导航链接。

## 自动化测试结果

- `npm run build`：通过。
- `npm test`：19 个后端测试全部通过。
- `npm run test:e2e:mobile-empty-shelf`：6 个移动/桌面场景全部通过。
- `node scripts/full-button-audit.cjs`：真实 Z-Library 账号登录成功；AI 配置保存成功；桌面和移动端按钮覆盖完成；网络错误 0、控制台错误 0、页面错误 0、需修复项 0。
- Android WebView 按钮审计：真机点击 35 个控件，覆盖移动主页、导入、书架、在线书源、搜索、格式筛选、换绑取消、下载触发、导入 TXT、阅读器基础按钮；产品功能失败 0。第一次脚本顺序漏测 AI tile 2 项，已用 `android-webview-ai-retake-20260519-080107` 复测通过，失败点击 0、失败检查 0。
- Android WebView 搜索回归：最终 APK 内 `SmartReadAPI.deploymentMode=android-native-backend`，`zlibBound=true`，搜索 `漫画易经` 返回 6 条，首条标题 `漫画易经`，并确认临时 `debug` 字段已移除。
- `npm run native:backend:audit`：Capacitor 无外部 `server.url`；Android/iOS embedded public assets 与 `mobile-www` 一致；Native API bridge 和 Android 插件注册检查全部通过；Android 插件确认包含 zlib、AI、TTS 和 speech 方法。
- `npm run native:backend:smoke`：mocked Capacitor 原生后端下模拟首次安装未绑定 zlib，移动首页进入 `android-native-backend`，用户为 `local-device@smartread.local`，没有产生 `/api/*` 请求，没有出现“获取验证码 / 登录 SmartRead / 6 位验证码”。
- Android WebView AI 真机复测：`AIConfig.save` 使用本地测试配置保存成功；`SmartReadAPI.aiChat` 返回“可用”；`AIService.chat` 返回“AI聊天可用”；阅读器 `Chat.send` 返回“聊天面板可用”；`AIReader.explainPage` 返回中文页面解读。
- Android WebView TTS / 字幕真机复测：`TTS.isSupported()` 为 `true`，`TTS.isNativeSpeech()` 为 `true`；直接 `SmartReadAPI.ttsSpeak` 2.5 秒后仍为 `pending` 且 `ttsStatus.ready=true`；前端长句朗读期间 `TTS.speaking=true`；当前句子高亮存在；点击下一句后 `current=1` 且仍在朗读；停止后高亮清除。
- Android WebView 大字幕回归：尝试 QQ 音乐式全量歌词列表后，真机发现 AI 解读长句在 Android WebView/TTS 高频切句时会出现多句视觉重叠；已调整验收目标为稳定上下文高亮模式。最终 `字幕大` 显示当前句上下各 2 句的全屏上下文窗口，当前句高亮、前后句弱化、可点任一句跳播；`字幕小` 保持底部单句浮层。真机截图 `test-artifacts/android-context-large-playing.png` 验证播放中无重叠、无遮挡。
- Android WebView 大字幕布局复测：阅读器内 `subtitle-large` 容器宽度 384px，文本宽度 346px，`documentElement.scrollWidth=384`，未超出视口；长中文和英文长 token 混排不会撑出横向滚动。
- Android WebView 移动主页布局复测：主页网格宽度 352px，视口宽度 384px，页面 `scrollWidth=384`；`继续阅读` 为 171x385 左侧两行；`我的书架` 为 171x187 右上；`导入` 为 171x187 右中，横跨原导入和 AI 两格；`在线找书` 为 171x187 左下；`账号` 与 `AI` 在右下并排，均为 81x187。
- Android WebView PDF 漫画兼容复测：Z-Library 书籍 `心解易经 漫画版` 已确认下载文件为有效 `PDF-1.4`，大小约 16.49 MB；真机打开后 PDF.js 成功渲染扫描漫画页，页码显示 `第 19 页 / 共 479 页`，验证截图：`test-artifacts/android-comic-pdf-opened.png`。
- Android WebView PDF 目录复测：阅读器目录按钮已接入 PDF.js `getOutline()`，可读取 PDF 内置 outline/bookmarks 并跳转到对应页；真机复测 `心解易经 漫画版` 文件本身没有内置 PDF outline，目录面板正常显示 `暂无目录`，无崩溃。
- Android WebView 语音入口复测：`Voice.canUseAndroidNativeRecognition()` 为 `true`；语音按钮可点击且标题为 `Android 本机语音输入`。实际语音转写需要用户现场授权麦克风并说话，本轮自动化验证到系统识别入口和权限桥接。
- `npm run android:build:debug`：构建成功。
- `aapt dump badging`：包名、启动 Activity、`INTERNET` 权限读取正常。
- `apksigner verify --verbose`：验签通过。
- `adb devices -l`：真机 `d66fdb58` 在线。

测试证据目录：

- Web 全功能按钮巡检：`C:\Users\lihuili\OneDrive\Desktop\reading-source-20260515-101237\test-artifacts\full-button-audit-20260519-075119`
- Android WebView 按钮巡检：`C:\Users\lihuili\OneDrive\Desktop\reading-source-20260515-101237\test-artifacts\android-webview-button-audit-20260519-075931`
- Android WebView AI retake：`C:\Users\lihuili\OneDrive\Desktop\reading-source-20260515-101237\test-artifacts\android-webview-ai-retake-20260519-080107`
- 移动端 e2e：`C:\Users\lihuili\OneDrive\Desktop\reading-source-20260515-101237\test-artifacts\mobile-empty-shelf-20260519-080344`
- Native backend smoke：`C:\Users\lihuili\OneDrive\Desktop\reading-source-20260515-101237\test-artifacts\native-backend-runtime-20260519075053`
- 最新 Native backend smoke：`C:\Users\lihuili\OneDrive\Desktop\reading-source-20260515-101237\test-artifacts\native-backend-runtime-20260519083712`
- 最终 Native backend smoke：`C:\Users\lihuili\OneDrive\Desktop\reading-source-20260515-101237\test-artifacts\native-backend-runtime-20260519085155`
- Android 主页矩形布局截图：`C:\Users\lihuili\OneDrive\Desktop\reading-source-20260515-101237\test-artifacts\android-ui\smartread-home-layout-final.png`
- Android PDF 漫画打开截图：`C:\Users\lihuili\OneDrive\Desktop\reading-source-20260515-101237\test-artifacts\android-comic-pdf-opened.png`

## 发现的问题与修复记录

- 问题：旧 APK 只是 WebView/standalone 壳，绕过 Web 后端和 zlib 主链路，安装后首页不可用且不符合“整合 zlib”的预期。
  修复：接入 `SmartReadBackendPlugin` Android 原生后端，WebView 中 `SmartReadAPI` 直接调用 Capacitor 原生插件，不再依赖外部 Node 服务。
- 问题：Android 原生后端首次启动仍可能显示 SmartRead 邮箱验证码登录，用户在首页点不到/收不到验证码。
  修复：Android `me()` 默认返回本机书架账号 `local-device@smartread.local`，首页不再进入 SmartRead 验证码登录；验证码接口返回“不需要邮箱验证码”的 native backend 消息；zlib 只通过“绑定 Z-Library”的邮箱/密码表单登录。
- 问题：Android 端可能显示 Z-Library 已绑定，但搜索返回“没找到”。
  修复：复测确认 `z-lib.fm` 使用测试账号搜索 `dao` 可返回 50 条结果，而 `z-library.sk` / `z-library.is` 会被反爬拦截；Android 搜索现已按 EPUB/PDF/TXT 默认格式查询，遇到 403/429/503、Cloudflare 或 Checking browser 页面时自动重试其它镜像，并把可用镜像写回本机配置，避免“假绑定但不可搜索”。
- 问题：Web 搜索正常、Android 全格式搜索仍直接返回无结果。
  根因：Android 原生 parser 的 Java 正则多写了一层反斜杠，导致已获取到的 50 个 `<z-bookcard>` 中 `id`、`title`、`download` 等字段全部匹配失败，最终 accepted=0。
  修复：修正 `attr()`、`slot()`、`parseTotalPages()`、`stripTags()` 的正则转义；真机复测 `dao` 返回 50 条，`漫画易经` 返回 6 条。
- 问题：Android 原生 HTTP 对压缩响应兼容性不足时可能解析失败。
  修复：Android HTTP 层显式请求 `Accept-Encoding: identity`，并兼容 `gzip/deflate` 自动解压。
- 问题：Android 绑定阶段可能长时间停在“正在绑定 Z-Library 书源”。
  修复：绑定阶段不再尝试已知容易卡住/反爬的 `z-library.is`，只用 `z-lib.fm` 和 `z-library.sk`；原生登录请求超时收紧到 12 秒连接 / 18 秒读取；前端绑定增加 45 秒超时兜底，超时后恢复按钮并显示错误。
- 问题：`js/api.js` 原先使用顶层 `const SmartReadAPI`，运行时不能被 Native bridge 可靠接管。
  修复：改为可重绑定全局 `var SmartReadAPI = window.SmartReadAPI = ...`，Native bridge 覆盖后同步重绑定。
- 问题：移动资源准备脚本未复制根级 `index.css`，Android WebView 首页样式缺失，表现为“糊糊的主页”。
  修复：`scripts/prepare-mobile-web.cjs` 同步复制根级 stylesheet，并在 native runtime 禁用重型 `backdrop-filter`。
- 问题：按钮巡检脚本第一次在书架页直接查找 AI tile，因未先返回移动主页导致 2 个脚本失败项。
  修复：确认不是产品问题；单独 retake 路径从主页点击 AI tile、打开 AI 设置、返回主页，失败点击 0、失败检查 0。
- 问题：Android APK 内 AI chat、AI 解读走 `/api/ai/chat` 服务端路径，原生 APK 没有外部 Node 服务时全部不可用。
  修复：`AIService.chat` 在 `SmartReadNativeBackend.enabled` 时改走 `SmartReadAPI.aiChat` 原生插件；AndroidManifest 允许当前测试用 HTTP OpenAI-compatible API 的 cleartext 请求；真机复测 `SmartReadAPI.aiChat`、`AIService.chat`、聊天面板和 AI 解读均返回有效文本。
- 问题：Android WebView 内 Web Speech TTS / SpeechRecognition 不可靠，导致 AI 朗读、上一句/下一句、当前句子高亮和语音入口不可用或行为不一致。
  修复：`SmartReadBackendPlugin` 新增 Android `TextToSpeech`、`ttsSpeak`、`ttsStop`、`ttsStatus` 和系统 `RecognizerIntent` 语音识别入口；前端 `TTS` / `Voice` 在 Android native backend 下优先调用原生能力，保留当前句子拆分、高亮、上一句/下一句和字幕联动。
- 问题：Android TTS 首次初始化失败后，插件保留了未 ready 的 `TextToSpeech` 对象，后续点击会立刻报“正在初始化”并停止；同时前端新朗读前异步 `ttsStop()` 没有等待完成，可能把刚开始的新朗读又停掉。
  修复：Manifest 增加 `android.intent.action.TTS_SERVICE` 查询可见性；插件显式选择系统默认 TTS engine，初始化失败会 shutdown 并清空状态；前端在 Android native TTS 下等待 `ttsStop()` 完成后再 `ttsSpeak()` 或跳句。真机复测 `ttsSpeak` 2.5 秒仍 pending，前端 `TTS.speaking=true`。
- 问题：字幕按钮点一次切换后，未处于朗读状态时字幕区域会消失，看起来“跳一下以后没反应”。
  修复：AI 字幕显示逻辑改为只要存在 AI 文本且字幕模式未关闭即可显示，当前字幕优先使用朗读中的句子，没有朗读时回退到 AI 结果文本；真机验证大/小/关闭切换正常。
- 问题：Android 大字幕模式直接使用 `100vw/100vh` 且内部文本没有强制断行，长句或中英文长 token 混排会超出页面。
  修复：大字幕容器改为 `left/right` 安全宽度、`100dvh`、横向隐藏、文本 `overflow-wrap:anywhere`/`word-break:break-word`；真机复测容器和文本宽度均未超过视口。
- 问题：QQ 音乐式全量歌词列表不适合 AI 解读长句，Android WebView 播放中自动滚动和长句多行换行会产生视觉重叠；退成单句后又与 `字幕小` 区分度不足。
  修复：调整 `字幕大` 为稳定上下文高亮窗口，只渲染当前句上下各 2 句，当前句高亮、前后句弱化，并支持点击任一句跳播；`字幕小` 仍为底部单句浮层。真机复测播放中无重叠。
- 问题：移动阅读主页的 Metro 瀑布流形成不规整的 L 形区域，`AI` 位置应下移到 `账号` 右侧，`导入` 应占据原 AI 空间。
  修复：主页恢复 4 列 Metro 矩形网格：`继续阅读` 占左侧两行，`我的书架` 在右上，`导入` 横跨右中两格，`在线找书` 在左下，`账号` 和 `AI` 在右下并排。
- 问题：Z-Library 下载的中文名大 PDF 漫画点击后打不开，真机错误为 `Failed to construct 'Response'`，同时大文件通过 base64 走 Capacitor JS bridge 存在卡顿/失败风险。
  根因：Android 原生 `fetchBookFile` 把 16.49 MB PDF 转成 base64 传回 WebView，且前端构造 `content-disposition` 时直接写入中文文件名，违反 WebView `Response` header 的 ISO-8859-1 限制。
  修复：原生插件改为返回本机文件路径和 MIME，前端用 `Capacitor.convertFileSrc()` 读取本机文件，不再桥接大文件 base64；`content-disposition` 改为 RFC 5987 `filename*` UTF-8 百分号编码。真机复测 `心解易经 漫画版` 成功打开并显示 `第 19 页 / 共 479 页`。
- 问题：PDF 阅读器目录按钮只支持 EPUB，PDF 即使有内置书签也会显示空目录。
  修复：`Reader.getTOC()` 新增 PDF outline 读取，使用 PDF.js `getOutline()` / `getDestination()` / `getPageIndex()` 解析为 `pdf:<page>` 跳转项；`Reader.display()` 支持 PDF 目录跳页。真机复测当前漫画 PDF 无内置 outline 时显示 `暂无目录`，不会影响阅读。

## 未解决风险

- Z-Library 是外部服务，镜像可用性、反爬策略、账号限流和下载地址有效性会变化；当前真机验证时间点 `z-lib.fm` 搜索可用。
- Android 按钮审计中下载按钮验证到“触发任务并出现 job state”，没有把几十 MB 外部书籍下载完成作为每次审计的阻塞条件；下载完成仍取决于 zlib 当前下载链路。
- 当前产物是 debug APK，使用 debug 签名；正式分发还需要 release 签名和版本号策略。
- Android 语音输入真实转写依赖系统语音识别服务、麦克风权限弹窗和现场说话；自动化已验证按钮、权限桥和系统识别入口，未把人工朗读内容识别准确率作为自动化阻塞项。
