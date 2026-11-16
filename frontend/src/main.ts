import "./android/webviewCompat";
import { createApp } from "vue";
import ElementPlus from "element-plus";
import zhCn from "element-plus/es/locale/lang/zh-cn";
import "element-plus/dist/index.css";
import "element-plus/theme-chalk/dark/css-vars.css";
import App from "./App.vue";
import "./stores/theme";
import "./styles/android.scss";
import "./styles/desktop.scss";
import { isAndroidOnline, isDesktop } from "./services/platform";

document.documentElement.classList.toggle("android", isAndroidOnline);
document.documentElement.classList.toggle("desktop", isDesktop);

const app = createApp(App);
app.config.globalProperties.$isDesktop = isDesktop;
app.use(ElementPlus, { locale: zhCn, zIndex: 2000 }).mount("#app");
