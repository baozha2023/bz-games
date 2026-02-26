import { createI18n } from "vue-i18n";
import type { AppSettings } from "../../shared/types";
import zhCN from "./locales/zh-CN";
import enUS from "./locales/en-US";
import jaJP from "./locales/ja-JP";

const i18n = createI18n({
  legacy: false, // use Composition API
  locale: "zh-CN", // default locale
  fallbackLocale: "en-US",
  messages: {
    "zh-CN": zhCN,
    "en-US": enUS,
    "ja-JP": jaJP,
  },
});

export type SupportedLocale = AppSettings["language"];

export const setLocale = (locale: SupportedLocale) => {
  i18n.global.locale.value = locale;
};

export default i18n;
