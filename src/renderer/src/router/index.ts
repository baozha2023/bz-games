import { createRouter, createWebHashHistory } from "vue-router";
import LibraryView from "../views/LibraryView.vue";

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: "/", redirect: "/library" },
    { path: "/library", name: "Library", component: LibraryView },
    {
      path: "/markets",
      name: "MarketList",
      component: () => import("../views/MarketListView.vue"),
    },
    {
      path: "/market",
      redirect: "/market/0",
    },
    {
      path: "/market/:sourceIdx",
      name: "Market",
      component: () => import("../views/MarketView.vue"),
    },
    {
      path: "/library/:id",
      name: "GameDetail",
      component: () => import("../views/GameDetailView.vue"),
    },
    {
      path: "/room/:id",
      name: "Room",
      component: () => import("../views/RoomView.vue"),
    },
    {
      path: "/rooms",
      name: "RoomDiscovery",
      component: () => import("../views/RoomDiscoveryView.vue"),
    },
    {
      path: "/social",
      name: "Social",
      component: () => import("../views/SocialView.vue"),
    },
    {
      path: "/settings",
      name: "Settings",
      component: () => import("../views/SettingsView.vue"),
    },
    {
      path: "/career",
      name: "Career",
      component: () => import("../views/CareerView.vue"),
    },
    {
      path: "/notification",
      name: "Notification",
      component: () => import("../views/NotificationView.vue"),
    },
    {
      path: "/chat-popout",
      name: "ChatPopout",
      component: () => import("../views/ChatPopoutView.vue"),
    },
    {
      path: "/personalization",
      name: "Personalization",
      component: () => import("../views/PersonalizationView.vue"),
    },
    {
      path: "/float-ball",
      name: "FloatBall",
      component: () => import("../views/FloatBallView.vue"),
    },
  ],
});

export default router;
