# SmartRead

SmartRead 是一个本地优先的 AI 阅读器，适合在手机上导入 EPUB、PDF、TXT 后阅读、听书、做 AI 逐页解读和管理个人书库。它的重点不是账号系统或云同步，而是把正文阅读、AI 解读、听书字幕、漫画和复杂图文混排内容做成可离线、自用、可控的单机体验。

## 应用功能特色

- 本地书架：导入的书籍和阅读进度保存在本机或手机本地，默认不依赖远程服务器。
- 多格式阅读：支持 EPUB、PDF、TXT，本地导入后可直接进入正文页阅读。
- 漫画和复杂图文：支持漫画书、扫描版 PDF 和复杂图文混排书籍的阅读场景。
- AI 逐页解读：可接入 OpenAI-compatible API，用自己的 API Base URL 和 Key 对当前页、章节或选中文本生成解读。
- AI 聊天：阅读时可以围绕当前内容提问，适合查词、总结、解释段落和辅助理解。
- 听书模式：支持正文朗读、当前句高亮、上一句、下一句和停止朗读。
- 字幕模式：支持字幕大、字幕小、字幕关闭，适合边听边看。
- 移动端阅读控件：底部功能栏固定在屏幕底部，不跟随正文滑动，不覆盖可阅读区域。
- 放大镜：正文页可双击开启或关闭放大镜，适合 PDF、扫描内容或小字号文本。
- 护眼和深色显示：阅读和听书控件会跟随主题，减少夜间阅读割裂感。
- Android 单机模式：APK 默认在手机本地运行，书架、AI 配置、在线书源配置和阅读状态都走本地存储。
- 内嵌找书入口：可搜索全球大量图书资源，覆盖小说、技术书、漫画书和图文混排书籍，实际可用性取决于外部书源状态。

## 适合谁用

- 想在 Android 手机上看 EPUB、PDF、TXT 的用户。
- 想把 AI 逐页解读和听书放进同一个阅读界面的用户。
- 不想依赖云端账号，也不想把私人书库交给第三方服务的用户。
- 需要自己配置 API Key、自己控制数据和模型入口的用户。

## 下载安装

### Android APK

到 GitHub Release 下载 APK：

[smartread.apk](https://github.com/xszwow/Smartread/releases/latest/download/smartread.apk)

手机安装：

1. 打开上面的 APK 下载链接。
2. 下载完成后点开安装包。
3. 如果系统提示禁止安装未知来源应用，给浏览器或文件管理器开启“安装未知应用”权限。
4. 安装完成后打开 SmartRead。

ADB 覆盖安装：

```powershell
adb install -r smartread.apk
```

当前 GitHub Release 提供的是 Android 安装包，适合自用、测试和真机验证，不是 Play Store 生产签名包。

### Windows

本地已有 Windows 构建产物时，可以运行：

```powershell
.\release\"SmartRead Setup 0.1.0.exe"
```

或免安装启动：

```powershell
.\release\win-unpacked\SmartRead.exe
```

Windows 公开分发需要正式代码签名证书，否则 SmartScreen 可能拦截。

## Android 使用说明

首次使用建议流程：

1. 安装 APK。
2. 打开应用进入书架。
3. 用“导入”添加 EPUB、PDF 或 TXT。
4. 进入正文页后，使用底部工具栏切换 AI、听书、字幕和放大镜。
5. 如需 AI 功能，在设置里填入自己的 API Base URL 和 API Key。

Android 端默认行为：

- 不要求登录远程 SmartRead 服务器。
- 书架、阅读进度和 AI 配置保存在设备本地。
- 听书优先使用 Android 原生 TextToSpeech。
- 语音输入优先使用 Android 系统语音识别，需要录音权限。

## 从源码构建 APK

本地测试 APK：

```powershell
npm run android:build:debug
```

输出路径：

```text
android/app/build/outputs/apk/debug/app-debug.apk
```

构建后安装：

```powershell
adb install -r .\android\app\build\outputs\apk\debug\app-debug.apk
```

Android release 构建入口已保留：

```powershell
npm run android:build:release
npm run android:build:bundle
```

生产 release 需要配置正式 Android keystore。不要把 keystore、密码、API Key 或生产证书提交到仓库。

## 开发命令

常用检查：

```powershell
npm test
npm run build
npm run mobile:sync
npm run android:build:debug
```

桌面端：

```powershell
npm run desktop:pack:win:dev-signed
npm run desktop:smoke:packaged
npm run desktop:smoke:installed
```

## 发布检查

发布前至少确认：

- `npm test` 通过。
- `npm run android:build:debug` 通过。
- APK 能用 `adb install -r` 覆盖安装。
- 真机能打开书架、导入书、进入正文页。
- AI、听书、字幕、放大镜和底部控件在手机端不遮挡正文。
- GitHub Release 的 Assets 里包含 `smartread.apk`。

## 当前仓库状态

- 当前主要开发分支：`安卓`
- Android 包名：`com.smartread.app`
- 当前应用版本：`1.0`
- 当前 npm 版本：`0.1.0`

## 相关文档

- 验证报告：`docs/verification-report.md`
- 发布状态：`docs/release-readiness-current.md`
- 功能覆盖矩阵：`docs/functional-test-matrix.md`
