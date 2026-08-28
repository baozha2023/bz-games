// @vitest-environment happy-dom

import { flushPromises, mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { createMemoryHistory, createRouter } from "vue-router";
import { beforeEach, describe, expect, it } from "vitest";
import { forumCommandLocales } from "../../locales/forum-commands";
import ForumPostBody from "./ForumPostBody.vue";

function i18n() {
  return createI18n({
    legacy: false,
    locale: "zh-CN",
    messages: { "zh-CN": { forumCommands: forumCommandLocales["zh-CN"] } },
  });
}

function router() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/", name: "Home", component: { template: "<div />" } },
      {
        path: "/settings",
        name: "Settings",
        component: { template: "<div />" },
      },
    ],
  });
}

describe("ForumPostBody page references", () => {
  beforeEach(() => {
    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      value: {
        market: {
          getSources: async () => ({ schemaVersion: 2, sources: [] }),
          getIndex: async () => {
            throw new Error("unused");
          },
        },
        forum: {
          resolvePostReferences: async () => ({ items: [] }),
        },
      },
    });
  });

  it("opens a registered page with its action query on the first click", async () => {
    const appRouter = router();
    await appRouter.push("/");
    const wrapper = mount(ForumPostBody, {
      props: { body: "/page<settings.feedback>" },
      global: { plugins: [i18n(), appRouter] },
    });
    await flushPromises();
    await wrapper.get("button.forum-reference--page").trigger("click");
    await flushPromises();
    expect(appRouter.currentRoute.value).toMatchObject({
      name: "Settings",
      query: { forumAction: "feedback" },
    });
  });

  it("renders an unknown future page as a non-interactive element", async () => {
    const appRouter = router();
    await appRouter.push("/");
    const wrapper = mount(ForumPostBody, {
      props: { body: "/page<future.screen>" },
      global: { plugins: [i18n(), appRouter] },
    });
    await flushPromises();
    expect(wrapper.find("button").exists()).toBe(false);
    expect(wrapper.get(".forum-reference--disabled").text()).toBe("未知页面");
  });
});
