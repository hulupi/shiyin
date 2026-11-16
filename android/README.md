# 拾音 Android

Android 版在 APK 内加载 Vue 页面，默认打开榜单。榜单、公开歌单和搜索由手机请求音乐平台。自定义音源在手机内的 QuickJS 沙箱中运行，音频由手机直接拉流。个人歌单、收藏、历史和音源设置存放在应用内。手机需要联网。第三方接口和音频地址需要支持 HTTPS。

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

打开 App 后，先打开一个榜单或公开歌单，再从「设置 → 音源管理」导入音源。选择音源支持的歌曲，检查播放、切歌和进度跳转。此版本使用 WebView 播放器，后台播放和锁屏续播尚未接入。
