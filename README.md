# SmartRead

SmartRead 是一个本地优先的阅读应用，支持 Windows 桌面版和 Android 安装包。当前重点是手机端阅读体验：本地书架、EPUB/PDF/TXT 导入、AI 解读、听书、字幕、放大镜和移动端底部控件适配。

## 下载安装

### Android APK

到 GitHub Release 下载 APK：

[SmartRead-android-debug.apk](https://github.com/xszwow/Smartread/releases/latest/download/SmartRead-android-debug.apk)

手机安装：

1. 打开上面的 APK 下载链接。
2. 下载完成后点开安装包。
3. 如果系统提示禁止安装未知来源应用，给浏览器或文件管理器开启“安装未知应用”权限。
4. 安装完成后打开 SmartRead。

ADB 覆盖安装：

```powershell
adb install -r SmartRead-android-debug.apk
```

如果是从源码本地构建，APK 输出在：

```text
android/app/build/outputs/apk/debug/app-debug.apk
```

本地构建并安装：

```powershell
npm run android:build:debug
adb install -r .\android\app\build\outputs\apk\debug\app-debug.apk
```

说明：当前 GitHub Release 提供的是 debug signed APK，适合自用、测试和真机验证，不是 Play Store 生产签名包。

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

## 主要功能

- 本地书架：书籍和进度默认保存在本机或手机本地。
- 文件导入：支持 EPUB、PDF、TXT。
- Android 单机模式：APK 默认不依赖外部 SmartRead 服务器。
- AI 解读：可配置 OpenAI-compatible API 地址和 Key。
- 听书与字幕：支持听书、当前句高亮、字幕大、字幕小、字幕关闭。
- 移动端阅读控件：底部功能栏固定，不跟随正文滑动。
- 放大镜：双击开启或关闭，滚动前后交互保持一致。
- Z-Library：可在配置后使用在线找书能力，实际可用性取决于外部服务状态。

## Android 使用说明

首次使用建议流程：

1. 安装 APK。
2. 打开应用进入书架。
3. 用“导入”添加 EPUB、PDF 或 TXT。
4. 进入正文页后，可使用底部工具栏切换 AI、听书、字幕和放大镜。
5. 如需 AI 功能，在设置中填入自己的 API Base URL 和 API Key。

Android 端默认是单机模式：

- 不要求登录远程服务器。
- 书架、阅读进度、AI 配置保存在设备本地。
- 听书优先使用 Android 原生 TextToSpeech。
- 语音输入优先使用 Android 系统语音识别，需要录音权限。

## 开发命令

常用命令：

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

Android release 构建入口已保留：

```powershell
npm run android:build:release
npm run android:build:bundle
```

生产 release 需要配置正式 Android keystore。不要把 keystore、密码、API Key 或生产证书提交到仓库。

## 发布检查

发布前至少确认：

- `npm test` 通过。
- `npm run android:build:debug` 通过。
- APK 能用 `adb install -r` 覆盖安装。
- 真机能打开书架、导入书、进入正文页。
- AI、听书、字幕、放大镜和底部控件在手机端不遮挡正文。
- GitHub Release 的 Assets 里包含 `SmartRead-android-debug.apk`。

## 当前仓库状态

- 当前主要开发分支：`安卓`
- Android 包名：`com.smartread.app`
- 当前应用版本：`1.0`
- 当前 npm 版本：`0.1.0`

## 相关文档

- 验证报告：`docs/verification-report.md`
- 发布状态：`docs/release-readiness-current.md`
- 功能覆盖矩阵：`docs/functional-test-matrix.md`
