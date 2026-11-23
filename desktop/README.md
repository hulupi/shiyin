# 拾音桌面客户端

安装后直接打开拾音。在「设置」中输入电脑上音乐文件夹的绝对路径，例如 Windows 上的 `D:\Music` 或 macOS 上的 `/Users/你的用户名/Music`，添加后开始扫描。曲库、歌单和设置保存在当前用户的应用数据目录。播放电脑上的音乐可离线使用，在线搜索和音源仍需要网络。

## 开发和打包

先在仓库根目录执行 `npm ci` 安装 Web 和服务端构建依赖，再进入本目录。

```powershell
npm ci
npm run build:runtime
npm start
npm run package:win
```

`npm start` 会先更新桌面运行时（前端和后端），再启动 Electron。修改源码后，从托盘菜单彻底退出拾音，再重新运行；目前不支持热更新。仅关闭窗口会隐藏到托盘。

Windows x64 试用安装包输出到 `desktop/dist/local/`。安装包未签名。

## macOS 打包

在 Mac 上使用 Node.js 22.18 或更新版本。从仓库根目录运行：

```bash
npm ci
npm --prefix desktop ci
npm --prefix desktop run package:mac -- --arm64
```

Apple 芯片使用 `--arm64`，Intel 芯片使用 `--x64`。DMG 输出到 `desktop/dist/local/`。

本机试用时，可以在打包命令末尾加 `--config.mac.identity=-` 使用临时签名。对外分发时，使用 Developer ID Application 签名并提交 Apple 公证。