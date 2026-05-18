# 迁移说明

本目录已经按“方便转移到另一台电脑”的目标清理过。清理后保留源码、配置、文档、移动端工程骨架、本地 Node 运行时、少量本地数据和签名文件；删除的是依赖、缓存、构建产物和可重新下载的工具链。

## 已清理内容

这些目录或文件已经删除，后续可以重新生成：

- `node_modules/`：npm 依赖，迁移后用 `npm ci` 恢复。
- `release/`：Windows 桌面安装包和免安装包，重新打包会生成。
- `.cache/`：electron-builder 缓存。
- `test-artifacts/`：测试截图、日志和临时产物。
- `dist/`、`mobile-www/`：构建输出。
- `android/.gradle/`、`android/build/`、`android/app/build/`：Android Gradle 构建输出。
- `tools/android-sdk/`、`tools/jdk-21/`：Android 构建工具链。
- `tools/*.zip`：Node/JDK/Android SDK 下载压缩包。

当前保留了 `tools/node-v24.15.0-win-x64/`，所以在另一台 Windows 电脑上不必先全局安装 Node.js。

## 迁移步骤

1. 复制整个 `reading-source-20260515-101237` 文件夹到另一台电脑。
2. 在新电脑上用 PowerShell 进入项目根目录。
3. 确认本地 Node 可用：

```powershell
.\tools\node-v24.15.0-win-x64\node.exe --version
```

4. 恢复 npm 依赖：

```powershell
.\tools\node-v24.15.0-win-x64\npm.cmd ci
```

5. 构建并做基础验证：

```powershell
.\tools\node-v24.15.0-win-x64\npm.cmd run build
.\tools\node-v24.15.0-win-x64\npm.cmd test
```

6. 开发运行桌面版：

```powershell
.\tools\node-v24.15.0-win-x64\npm.cmd run desktop:dev
```

7. 重新生成 Windows 安装包：

```powershell
.\tools\node-v24.15.0-win-x64\npm.cmd run desktop:pack:win:unsigned
```

生成结果会重新出现在 `release/`。

## Android 构建

如果新电脑只需要运行网页/桌面版，可以不用恢复 Android 工具链。

如果需要构建 Android，需重新准备：

- JDK 21：放到 `tools/jdk-21/`
- Android SDK：放到 `tools/android-sdk/`
- SDK 内至少包含 `platforms/android-36` 和 `build-tools/36.0.0`
- `cmdline-tools/latest` 和 `platform-tools`

准备好后运行：

```powershell
.\tools\node-v24.15.0-win-x64\npm.cmd run android:build:debug
.\tools\node-v24.15.0-win-x64\npm.cmd run android:build:release
```

Android 产物会重新生成到 `android/app/build/outputs/`。

## 注意事项

- `data/` 里有本地 SQLite 数据；如果要迁移个人阅读数据，保留它。如果要发给别人，建议先确认里面没有隐私数据。
- `certs/` 里有本地开发签名证书；转移到自己的电脑可以保留，公开分享前建议删除。
- `release/`、`dist/`、`mobile-www/`、`node_modules/` 都是可再生成目录，不需要手动拷回。
- 如果 `npm ci` 失败，先确认网络可访问 npm registry，再删除残留的 `node_modules/` 后重试。
