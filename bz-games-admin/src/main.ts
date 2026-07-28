import { createApp } from "vue";
import {
  create,
  NAvatar,
  NButton,
  NCard,
  NConfigProvider,
  NDataTable,
  NDescriptions,
  NDescriptionsItem,
  NDivider,
  NForm,
  NFormItem,
  NImage,
  NInput,
  NLayout,
  NLayoutContent,
  NLayoutHeader,
  NLayoutSider,
  NMenu,
  NMessageProvider,
  NModal,
  NPagination,
  NSelect,
  NSpace,
  NSpin,
  NTag,
  NText,
} from "naive-ui";
import { createPinia } from "pinia";

import App from "./App.vue";
import { router } from "./router";
import "./styles.css";

const naive = create({
  components: [
    NAvatar,
    NButton,
    NCard,
    NConfigProvider,
    NDataTable,
    NDescriptions,
    NDescriptionsItem,
    NDivider,
    NForm,
    NFormItem,
    NImage,
    NInput,
    NLayout,
    NLayoutContent,
    NLayoutHeader,
    NLayoutSider,
    NMenu,
    NMessageProvider,
    NModal,
    NPagination,
    NSelect,
    NSpace,
    NSpin,
    NTag,
    NText,
  ],
});

createApp(App).use(createPinia()).use(router).use(naive).mount("#app");
