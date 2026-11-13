# 拾音 FPK 构建与安装

## 运行方式

- 入口：`/app/shiyin/`，使用浏览器标签页打开，由 fnOS 统一网关验证系统登录态。
- 应用只监听 `${TRIM_APPDEST}/app.sock`，生产模式缺少 Socket 或网关配置会拒绝启动，不回退到 TCP。
- 前端资源、API、音频、封面、歌词和下载地址均使用网关前缀。
- 最低 fnOS 版本：`1.1.3100`（官方统一网关要求）；依赖应用中心的 `nodejs_v22`，项目需要 Node.js >= 22.18。
- 以专用应用用户运行；数据库和日志放入 `${TRIM_PKGVAR}`，升级不覆盖该目录。
- 当前音乐库、歌单、音源和下载任务属于应用共享数据，尚未按 fnOS 用户隔离。
- 需要访问 NAS 音乐目录时，在应用设置中授权相应目录。网关登录保护不替代文件目录权限。

## 构建

先在仓库根目录执行 `npm ci`。从官方地址下载对应开发机版本的 fnpack 1.2.3：

https://developer.fnnas.com/docs/cli/fnpack

Windows 可将工具放在 `backend/data/fnpack.exe`；Linux/macOS 放在 `backend/data/fnpack` 并赋予执行权限。也可用环境变量 `FNPACK_PATH` 指定工具绝对路径。

```powershell
npm run typecheck --workspace frontend
npx tsc --noEmit -p backend/tsconfig.json
npm run package:fpk
```

脚本构建带网关前缀的前端，将后端 TypeScript 转译为 JavaScript，在独立 staging 目录用锁文件安装后端运行依赖，并调用官方 `fnpack build`。安装包不包含开发数据、私有音源、凭据或开发环境配置。运行不依赖 tsx。

安装包输出到 fpk/shiyin-0.1.12-all.fpk。打包在系统临时目录中进行，成功后会清理本次暂存目录。安装包和 fnOS 桌面入口均使用拾音图标，源文件位于 fpk 及其 app/ui/images 子目录。

## 安装与验证

发布新版本时，同步维护 `fpk/manifest` 的 `changelog` 与 `fpk/wizard/install`、`fpk/wizard/upgrade` 中的版本说明。

拾音使用应用 ID `shiyin`。在 fnOS 中按新应用安装，并重新授权音乐目录。

1. 在 fnOS 应用中心安装 Node.js 22 运行时，并检查版本满足要求。
2. 使用手动安装功能选择 FPK，阅读并勾选同意免责声明与使用许可，再查看安装说明、目录授权和版本说明。安装后按需在应用中心授权目录，再从桌面打开拾音，在设置中添加音乐库路径。
3. 从应用入口打开，确认页面、封面、播放、歌词和下载正常。
4. 退出 fnOS 登录或使用无痕窗口访问入口，确认系统要求登录。
5. 检查应用进程只有 Unix Socket，无 TCP 监听；检查停止和重启后 Socket 清理与重建正常。
6. 升级后确认数据库、歌单和音源保留。卸载时按系统提示选择数据保留策略；应用卸载脚本不主动删除用户下载文件。

日志：`${TRIM_PKGVAR}/app.log`。状态由 `cmd/main status` 提供，停止返回状态码 3。

## 本次验证范围

Windows 本机已验证前后端类型检查、前端生产构建，以及打包目录中真实 JavaScript 服务的启动。集成测试覆盖网关边界、缺少用户 Header 的拒绝响应、入口跳转、前缀静态资源/API、跨站写入拒绝，以及生产模式缺少 Socket 时启动失败。

本机没有可用 Linux/fnOS 测试设备，Unix Socket 的 Linux 权限、应用中心安装/升级/卸载、系统登录跳转和 x86/ARM 真机运行仍须按上面的步骤验收；本机测试通过不代表真机验收完成。

## 官方依据

- https://developer.fnnas.com/docs/core-concepts/gateway-registration
- https://developer.fnnas.com/docs/examples/native
- https://developer.fnnas.com/docs/core-concepts/manifest
- https://developer.fnnas.com/docs/cli/fnpack

Windows 构建完成后，脚本将 FPK 外层归档中的生命周期脚本执行位规范为 0755；内部 app.tgz 和 manifest 中的 payload 校验值保持不变。最终包已验证归档结构、脚本 LF 换行、执行位、payload MD5 和 SHA-256。生命周期脚本也已通过 Bash 语法检查。

## 0.1.1 修复

桌面入口从 iframe 改为 url。网关模式不再用后端 Host 与浏览器 Origin 比较；写请求必须带 X-Shiyin-Request: 1，由统一前端请求封装添加，且拒绝跨站/跨源同站的 Fetch Metadata。这些自定义头会触发外源浏览器预检，服务不开放 CORS。开发直连模式保留原来的 Origin/Host 校验。fnOS 登录身份要求和生产 Unix Socket 监听不变。

回归测试模拟网关重写 Host，实际调用添加目录接口并验证 201 和目录入库，同时覆盖缺少自定义头、跨站请求、null Origin、外源预检的拒绝。升级为 0.1.1 后关闭旧应用窗口并重新打开入口；若页面仍使用缓存，可强制刷新。

## 0.1.2 音源运行资源修复

补齐按路径动态加载的 backend/src/source-runtime/worker.mjs 和 backend/src/source-runtime/bootstrap.js。此前打包脚本只转译服务器和 contracts 的 TypeScript，漏掉这两个文件，导致安装版导入时报“音源运行环境异常”，开发环境因文件存在而正常。

回归用例在旧包 staging 中重现相同的 400 错误。打包流程现在会在调用 fnpack 前启动独立 staging 中的服务，验证真实接口的音源导入和检测，以及 QuickJS/WASM 启动、桥接加密、定时器初始化、Promise、宿主隔离和请求分发。测试使用内置最小音源，不读取或打包用户私有音源。

0.1.2 同时处理播放控制竞态：等待播放或 AudioContext 准备期间点击暂停会取消旧播放意图，避免之后恢复；切歌、pause/load 引起的 AbortError 按取消处理，真实格式和权限错误仍会报告。Chrome 对该错误的说明：https://developer.chrome.com/blog/play-request-was-interrupted

## 0.1.3 系统媒体控制

接入标准 Media Session，提供歌曲名、歌手、专辑与封面，注册播放、暂停、上一首、下一首、停止、快进/快退和进度定位。系统操作复用页面队列及播放模式；播放与暂停使用独立指令，重复的系统播放命令不会反向暂停。同步实际播放状态和进度，离开播放器时清理媒体会话。不支持接口或单个动作的 WebView 会保持原有网页播放能力。

本地自动测试覆盖控制事件、元数据、封面绝对地址、状态进度、切歌及兼容性降级。Android 通知栏/锁屏卡片是否展示仍依赖飞牛 App WebView 对系统媒体会话的转发，尚未在用户设备实测。若 App 内不显示，可使用支持 Media Session 的 Android 浏览器打开同一网关地址验证。接口说明：https://developer.mozilla.org/en-US/docs/Web/API/Media_Session_API
