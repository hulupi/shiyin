# 拾音 Android

Android 版在 APK 内加载 Vue 页面，默认打开榜单。榜单、公开歌单和搜索由手机请求音乐平台。自定义音源在手机内的 QuickJS 沙箱中运行，音频由手机直接拉流。个人歌单、收藏、历史和音源设置存放在应用内。手机需要联网。第三方接口使用 HTTPS。音频支持 HTTPS，以及 Android 网络配置中明确开放的 HTTP 音频域名。

## 构建调试 APK

安装 Node.js 22.18 或更新版本、JDK 21，以及 Android SDK Platform 36。通过 Android Studio 构建时可使用其内置 JDK。

从仓库根目录执行：

```powershell
npm ci
npm run android:sync
npm run android:open
```

也可在已设置 `JAVA_HOME` 和 `ANDROID_HOME` 的终端构建：

```powershell
Push-Location android
.\gradlew.bat assembleDebug
Pop-Location
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

打开 App 后，先打开一个榜单或公开歌单，再从「设置 → 音源管理」导入音源。选择音源支持的歌曲，检查播放、切歌和进度跳转。安卓版通过 Media3 前台服务播放。播放时可以切到后台或锁屏，系统媒体通知提供播放和暂停控制。播放队列和取链由 Media3 服务管理，服务持有独立的本地 WebView 音源执行环境，不依赖 Activity 页面回调。只准备下一首，临近结束时取链；播放出错时重新取链并有限重试。此架构需要在目标手机上验证锁屏连续播放及系统后台限制。

## 后台播放验证与日志

安装最新调试 APK 后，在列表循环模式下选择至少 30 首歌，锁屏连续播放，确认超过之前 10–20 首的中断位置。再测试暂停后等待、恢复播放、断网恢复及手动切歌。当前没有连接设备时，构建和队列单元检查不能替代此实测。

设备连接 adb 后可用 `adb logcat -s ShiyinPlayback` 查看后台取链成功或失败记录。

无需 JUnit 下载的队列边界测试（PowerShell，已配置 `JAVA_HOME`）：

```powershell
New-Item -ItemType Directory -Force android/app/build/queue-tests | Out-Null
& "$env:JAVA_HOME/bin/javac.exe" -encoding UTF-8 -d android/app/build/queue-tests android/app/src/main/java/app/shiyin/music/ShiyinQueueOrder.java android/tests/ShiyinQueueOrderTest.java
& "$env:JAVA_HOME/bin/java.exe" -cp android/app/build/queue-tests app.shiyin.music.ShiyinQueueOrderTest
```