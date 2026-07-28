import { createRouter, createWebHistory } from "vue-router";

import FeedbackView from "./views/FeedbackView.vue";
import LoginView from "./views/LoginView.vue";
import { useAuthStore } from "./stores/auth";

export const router = createRouter({
  history: createWebHistory("/admin/"),
  routes: [
    { path: "/login", name: "login", component: LoginView },
    {
      path: "/",
      name: "feedback",
      component: FeedbackView,
      meta: { requiresAuth: true },
    },
    { path: "/:pathMatch(.*)*", redirect: "/" },
  ],
});

router.beforeEach(async (to) => {
  const auth = useAuthStore();
  if (!auth.checked) await auth.refresh();
  if (to.meta.requiresAuth && !auth.user) {
    return { name: "login" };
  }
  if (to.name === "login" && auth.user) {
    return { name: "feedback" };
  }
  return true;
});
