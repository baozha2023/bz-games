import { createApp } from "vue";
import {
  create,
  NAlert,
  NAvatar,
  NButton,
  NCard,
  NCheckbox,
  NConfigProvider,
  NDataTable,
  NDescriptions,
  NDescriptionsItem,
  NDivider,
  NDynamicInput,
  NEllipsis,
  NEmpty,
  NDatePicker,
  NForm,
  NFormItem,
  NImage,
  NInput,
  NInputNumber,
  NLayout,
  NLayoutContent,
  NLayoutHeader,
  NLayoutSider,
  NMenu,
  NMessageProvider,
  NModal,
  NPagination,
  NProgress,
  NSelect,
  NSpace,
  NSpin,
  NSwitch,
  NTabPane,
  NTabs,
  NTag,
  NText,
  NTree,
} from "naive-ui";
import { createPinia } from "pinia";

import App from "./App.vue";
import { setForbiddenHandler } from "./api";
import { router } from "./router";
import { useAuthStore } from "./stores/auth";
import "./styles.css";

const naive = create({
  components: [
    NAlert,
    NAvatar,
    NButton,
    NCard,
    NCheckbox,
    NConfigProvider,
    NDataTable,
    NDescriptions,
    NDescriptionsItem,
    NDivider,
    NDynamicInput,
    NEllipsis,
    NEmpty,
    NDatePicker,
    NForm,
    NFormItem,
    NImage,
    NInput,
    NInputNumber,
    NLayout,
    NLayoutContent,
    NLayoutHeader,
    NLayoutSider,
    NMenu,
    NMessageProvider,
    NModal,
    NPagination,
    NProgress,
    NSelect,
    NSpace,
    NSpin,
    NSwitch,
    NTabPane,
    NTabs,
    NTag,
    NText,
    NTree,
  ],
});

const pinia = createPinia();
const auth = useAuthStore(pinia);
setForbiddenHandler(() => {
  void auth.refresh().then(async () => {
    const required = router.currentRoute.value.meta.capability;
    if (required && !auth.can(required)) {
      await router.replace(auth.can("hosting.view") ? "/game-hosting" : "/login");
    }
  });
});

createApp(App).use(pinia).use(router).use(naive).mount("#app");
