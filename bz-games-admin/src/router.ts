import { createRouter, createWebHistory } from "vue-router";

import { useAuthStore } from "./stores/auth";
import type { PortalCapability } from "./rbac";

declare module "vue-router" {
  interface RouteMeta {
    requiresAuth?: boolean;
    capability?: PortalCapability;
  }
}

const FeedbackView = () => import("./views/FeedbackView.vue");
const GameHostingView = () => import("./views/GameHostingView.vue");
const LoginView = () => import("./views/LoginView.vue");
const ReleaseUploadView = () => import("./views/ReleaseUploadView.vue");
const UserListView = () => import("./views/UserListView.vue");

export const router = createRouter({
  history: createWebHistory("/admin/"),
  routes: [
    { path: "/login", name: "login", component: LoginView },
    {
      path: "/feedback",
      name: "feedback",
      component: FeedbackView,
      meta: { requiresAuth: true, capability: "feedback.view" },
    },
    {
      path: "/users",
      name: "users",
      component: UserListView,
      meta: { requiresAuth: true, capability: "users.view" },
    },
    {
      path: "/desktop-release",
      name: "desktop-release",
      component: ReleaseUploadView,
      meta: { requiresAuth: true, capability: "release.view" },
    },
    {
      path: "/game-hosting",
      name: "game-hosting",
      component: GameHostingView,
      meta: { requiresAuth: true, capability: "hosting.view" },
    },
    { path: "/", redirect: "/game-hosting" },
    { path: "/:pathMatch(.*)*", redirect: "/game-hosting" },
  ],
});

router.beforeEach(async (to) => {
  const auth = useAuthStore();
  if (!auth.checked) await auth.refresh();
  if (to.meta.requiresAuth && !auth.user) {
    return { name: "login", query: { redirect: to.fullPath } };
  }
  if (to.meta.capability && !auth.can(to.meta.capability)) {
    return auth.can("hosting.view")
      ? { name: "game-hosting" }
      : { name: "login" };
  }
  if (to.name === "login" && auth.user) {
    if (!auth.can("hosting.view")) return true;
    const redirect =
      typeof to.query.redirect === "string" && to.query.redirect.startsWith("/")
        ? to.query.redirect
        : auth.can("feedback.view")
          ? "/feedback"
          : "/game-hosting";
    return redirect;
  }
  return true;
});
