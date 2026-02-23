import { createI18n } from 'vue-i18n';
import zhCN from './locales/zh-CN';
import enUS from './locales/en-US';
import jaJP from './locales/ja-JP';

const i18n = createI18n({
  legacy: false, // use Composition API
  locale: 'zh-CN', // default locale
  fallbackLocale: 'en-US',
  messages: {
    'zh-CN': zhCN,
    'en-US': enUS,
    'ja-JP': jaJP,
  },
});

export default i18n;
