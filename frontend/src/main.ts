import { createApp } from "vue";
import ElementPlus from "element-plus";
import zhCn from "element-plus/es/locale/lang/zh-cn";
import "element-plus/dist/index.css";
import "element-plus/theme-chalk/dark/css-vars.css";
import App from "./App.vue";
import "./stores/theme";
import { isDesktop } from "./services/platform";

document.documentElement.classList.toggle("is-desktop", isDesktop);

const app = createApp(App);
app.config.globalProperties.$isDesktop = isDesktop;
app.use(ElementPlus, { locale: zhCn, zIndex: 2000 }).mount("#app");
