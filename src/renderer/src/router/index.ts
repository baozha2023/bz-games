import { createRouter, createWebHashHistory } from "vue-router";
import LibraryView from "../views/LibraryView.vue";
import StatisticsView from "../views/StatisticsView.vue";

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
      path: "/settings",
      name: "Settings",
      component: () => import("../views/SettingsView.vue"),
    },
    {
      path: "/statistics",
      name: "Statistics",
      component: StatisticsView,
    },
    {
      path: "/achievements",
      name: "Achievements",
      component: () => import("../views/AchievementsView.vue"),
    },
    {
      path: "/notification",
      name: "Notification",
      component: () => import("../views/NotificationView.vue"),
    },
  ],
});

export default router;
