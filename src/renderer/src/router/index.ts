import { createRouter, createWebHashHistory } from 'vue-router';
import LibraryView from '../views/LibraryView.vue';

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', redirect: '/library' },
    { path: '/library', name: 'Library', component: LibraryView },
    { path: '/library/:id', name: 'GameDetail', component: () => import('../views/GameDetailView.vue') },
    { path: '/room/:id', name: 'Room', component: () => import('../views/RoomView.vue') },
    { path: '/settings', name: 'Settings', component: () => import('../views/SettingsView.vue') },
    { path: '/statistics', name: 'Statistics', component: () => import('../views/StatisticsView.vue') },
  ]
});

export default router;
