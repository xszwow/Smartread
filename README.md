# SmartRead

SmartRead 是一个本地优先的 AI 阅读器，适合在 Android 手机或 Windows 电脑上导入 EPUB、PDF、TXT 后阅读、听书、做 AI 按页解读和管理个人书库。它支持自定义 OpenAI-compatible API，可以使用自己的 API Base URL、API Key 和模型名接入兼容服务。阅读时可以选择按原文直接朗读，也可以选择生成并收听 AI 解读。它的重点不是账号系统或云同步，而是把正文阅读、AI 解读、听书字幕、漫画和复杂图文混排内容做成可离线、自用、可控的单机体验。

## 应用功能特色

- 本地书架：导入的书籍和阅读进度保存在本机或手机本地，默认不依赖远程服务器。
- 多格式阅读：支持 EPUB、PDF、TXT，本地导入后可直接进入正文页阅读。
- 漫画和复杂图文：支持漫画书、扫描版 PDF 和复杂图文混排书籍的阅读场景。
- 自定义 AI 接口：支持 OpenAI-compatible API，可填写自己的 API Base URL、API Key 和模型名，不绑定单一服务商。
- AI 按页解读：对当前页、章节或选中文本生成解读，适合长文、专业书和图文混排内容。
- AI 聊天：阅读时可以围绕当前内容提问，适合查词、总结、解释段落和辅助理解。
- 听书模式：可选择按原文直接朗读，也可收听 AI 解读，支持当前句高亮、上一句、下一句和停止朗读。
- 字幕模式：支持字幕大、字幕小、字幕关闭，适合边听边看。
- 移动端阅读控件：底部功能栏固定在屏幕底部，不跟随正文滑动，不覆盖可阅读区域。
- 放大镜：正文页可双击开启或关闭放大镜，适合 PDF、扫描内容或小字号文本。
- Windows 页面缩放：桌面版的 PDF、图片页、EPUB 文字页和 TXT 文字页支持整页缩放与拖拽查看，不通过修改字号放大内容。
- 护眼和深色显示：阅读和听书控件会跟随主题，减少夜间阅读割裂感。
- Android 单机模式：APK 默认在手机本地运行，书架、AI 配置、在线书源配置和阅读状态都走本地存储。
- 内嵌找书入口：可搜索全球大量图书资源，覆盖小说、技术书、漫画书和图文混排书籍，实际可用性取决于外部书源状态。

## 界面截图

<table>
  <tr>
    <td align="center"><img src="docs/screenshots/smartread-home.png" width="220" alt="SmartRead 阅读主页"><br>阅读主页</td>
    <td align="center"><img src="docs/screenshots/smartread-search.png" width="220" alt="SmartRead 搜书下载"><br>搜书下载</td>
    <td align="center"><img src="docs/screenshots/smartread-library.png" width="220" alt="SmartRead 我的书架"><br>我的书架</td>
  </tr>
  <tr>
    <td align="center"><img src="docs/screenshots/smartread-reader.png" width="220" alt="SmartRead 正文阅读"><br>正文阅读</td>
    <td align="center"><img src="docs/screenshots/smartread-tts.png" width="220" alt="SmartRead 听书模式"><br>听书模式</td>
    <td align="center"></td>
  </tr>
</table>

## 适合谁用

- 想在 Android 手机上看 EPUB、PDF、TXT 的用户。
- 想把 AI 按页解读、原文朗读和解读朗读放进同一个阅读界面的用户。
- 不想依赖云端账号，也不想把私人书库交给第三方服务的用户。
- 需要自己配置 API Key、自己控制数据和模型入口的用户。

## 下载安装

### Android APK

到 GitHub Release 下载 APK：

[BGsmartread.apk](https://github.com/xszwow/Smartread/releases/download/v0.1.0-android.1/BGsmartread.apk)

手机安装：

1. 打开上面的 APK 下载链接。
2. 下载完成后点开安装包。
3. 如果系统提示禁止安装未知来源应用，给浏览器或文件管理器开启“安装未知应用”权限。
4. 安装完成后打开 SmartRead。

当前 Android 安装包适合自用、测试和真机验证，不是 Play Store 生产签名包。

### Windows

到 GitHub Release 下载 Windows 安装包：

[SmartRead-Setup-0.1.0.exe](https://github.com/xszwow/Smartread/releases/latest/download/SmartRead-Setup-0.1.0.exe)

下载后运行安装包，或在本地构建后运行：

```powershell
.\release\"SmartRead Setup 0.1.0.exe"
```

或免安装启动：

```powershell
.\release\win-unpacked\SmartRead.exe
```

Windows 安装包当前为未签名测试分发版本，SmartScreen 可能提示风险；确认来源为本仓库 Release 后再继续安装。

## Android 使用说明

首次使用建议流程：

1. 安装 APK。
2. 打开应用进入书架。
3. 用“导入”添加 EPUB、PDF 或 TXT。
4. 进入正文页后，使用底部工具栏切换 AI、听书、字幕和放大镜。
5. 如需 AI 功能，在设置里填入自己的 OpenAI-compatible API Base URL、API Key 和模型名。

Android 端默认行为：

- 不要求登录远程 SmartRead 服务器。
- 书架、阅读进度和 AI 配置保存在设备本地。
- AI 接口由用户自行配置，支持 OpenAI 协议兼容服务。
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
- Android GitHub Release 的 Assets 里包含现有 `BGsmartread.apk`。
- Windows GitHub Release 的 Assets 里包含 `SmartRead-Setup-0.1.0.exe`。

## 当前仓库状态

- 当前主要开发分支：`安卓`
- Android 包名：`com.smartread.app`
- 当前应用版本：`1.0`
- 当前 npm 版本：`0.1.0`

## 相关文档

- 验证报告：`docs/verification-report.md`
- 发布状态：`docs/release-readiness-current.md`
- 功能覆盖矩阵：`docs/functional-test-matrix.md`

## 友情链接
linux.do
