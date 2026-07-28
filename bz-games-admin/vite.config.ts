import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  base: "/admin/",
  plugins: [vue()],
  server: {
    proxy: {
      "/api": "http://127.0.0.1:38090",
      "/auth": "http://127.0.0.1:38090",
    },
  },
});
