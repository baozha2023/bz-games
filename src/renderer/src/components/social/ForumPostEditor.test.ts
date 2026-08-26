// @vitest-environment happy-dom

import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ForumPostSummary } from "../../../../shared/types";
import { forumCommandLocales } from "../../locales/forum-commands";
import ForumPostEditor from "./ForumPostEditor.vue";

function post(index: number, title = `帖子 ${index}`): ForumPostSummary {
  return {
    id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    title,
    authorNickname: "作者",
    authorGithubLogin: "author",
    createdAt: "2026-08-24T00:00:00.000Z",
    likeCount: 0,
    commentCount: 0,
  };
}

function placeCaretAtEnd(element: HTMLElement): void {
  const node = element.lastChild;
  const range = document.createRange();
  if (!node) {
    range.setStart(element, 0);
    range.collapse(true);
  } else if (node.nodeType === Node.TEXT_NODE) {
    range.setStart(node, node.textContent?.length || 0);
    range.collapse(true);
  } else {
    range.selectNodeContents(node);
    range.collapse(false);
  }
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

function i18n() {
  return createI18n({
    legacy: false,
    locale: "zh-CN",
    messages: {
      "zh-CN": {
        forumCommands: forumCommandLocales["zh-CN"],
        social: {
          bodyTooLong: "正文过长",
          insertGame: "插入游戏",
          marketCandidate: "市场",
        },
      },
    },
  });
}

describe("ForumPostEditor command interactions", () => {
  let wrapper: VueWrapper | null = null;
  let searchAvailable = true;
  const listPosts = vi.fn();
  const resolvePostReferences = vi.fn();

  beforeEach(() => {
    searchAvailable = true;
    listPosts.mockImplementation(async (query = "") => ({
      items: Array.from({ length: 12 }, (_, index) =>
        post(index + 1, `${query || "最近"}帖子 ${index + 1}`),
      ),
      nextCursor: null,
      hasMore: true,
    }));
    resolvePostReferences.mockImplementation(async (ids: string[]) => ({
      items: ids.map((id) => ({
        id,
        status: "active" as const,
        title: "历史帖子",
        body: "历史正文",
      })),
    }));
    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      value: {
        forum: {
          getSearchAvailability: vi.fn(async () => searchAvailable),
          listPosts,
          resolvePostReferences,
        },
        market: {
          getSources: vi.fn(async () => ({
            schemaVersion: "1",
            sources: [
              {
                marketId: "official",
                marketName: "官方市场",
                generatedAt: "2026-08-24T00:00:00.000Z",
                repository: "https://github.com/example/official",
                branch: "main",
              },
            ],
          })),
          getIndex: vi.fn(async () => ({
            schemaVersion: "1",
            marketId: "official",
            marketName: "官方市场",
            generatedAt: "2026-08-24T00:00:00.000Z",
            updatedAt: "2026-08-24T00:00:00.000Z",
            games: [
              {
                id: "com.bz.demo",
                name: "演示游戏",
                author: "BZ",
                description: "",
                tags: [],
                versions: [
                  {
                    version: "1.0.0",
                    description: "稳定版",
                  },
                ],
              },
            ],
          })),
        },
      },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    wrapper?.unmount();
    wrapper = null;
    document.body.replaceChildren();
    vi.clearAllMocks();
  });

  async function mountEditor(modelValue = "/"): Promise<VueWrapper> {
    wrapper = mount(ForumPostEditor, {
      attachTo: document.body,
      props: { modelValue },
      global: {
        plugins: [i18n()],
        stubs: { Teleport: true, NSpin: true },
      },
    });
    await flushPromises();
    const editor = wrapper.get<HTMLElement>(".forum-post-editor");
    await editor.trigger("focus");
    placeCaretAtEnd(editor.element);
    await editor.trigger("keyup", { key: modelValue.at(-1) || "/" });
    await flushPromises();
    return wrapper;
  }

  function commandButton(mounted: VueWrapper, name: string) {
    return mounted
      .findAll(".forum-command-option--command")
      .find((button) => button.text().includes(`/${name}`));
  }

  it("shows a dedicated post search and limits both recent and searched results to ten", async () => {
    const mounted = await mountEditor();
    expect(mounted.find(".forum-command-post-search").exists()).toBe(false);

    const postCommand = mounted
      .findAll(".forum-command-option--command")
      .find((button) => button.text().includes("/post"));
    expect(postCommand).toBeDefined();
    await postCommand!.trigger("mousedown");
    await flushPromises();

    const search = mounted.get<HTMLInputElement>(".forum-command-post-search");
    expect(listPosts).toHaveBeenCalledWith("");
    expect(mounted.findAll(".forum-command-option")).toHaveLength(10);

    vi.useFakeTimers();
    await search.setValue("测试");
    await vi.advanceTimersByTimeAsync(251);
    await flushPromises();
    expect(listPosts).toHaveBeenLastCalledWith("测试");
    expect(mounted.findAll(".forum-command-option")).toHaveLength(10);
    expect(mounted.text()).toContain("测试帖子 1");

    await search.setValue("a".repeat(101));
    await vi.advanceTimersByTimeAsync(251);
    await flushPromises();
    expect(listPosts).toHaveBeenLastCalledWith("a".repeat(100));
    vi.useRealTimers();
  });

  it("hides post creation when search is unavailable but still resolves stored post references", async () => {
    searchAvailable = false;
    const mounted = await mountEditor();
    expect(
      mounted
        .findAll(".forum-command-option--command")
        .some((button) => button.text().includes("/post")),
    ).toBe(false);

    mounted.unmount();
    wrapper = null;
    document.body.replaceChildren();
    const postId = "00000000-0000-4000-8000-000000000001";
    const stored = await mountEditor(`/post<${postId}>`);
    expect(resolvePostReferences).toHaveBeenCalledWith([postId]);
    expect(stored.find(".forum-reference--post").exists()).toBe(true);
    expect(stored.text()).toContain("历史帖子");
  });

  it("removes a stale post command when Elasticsearch becomes unavailable", async () => {
    const mounted = await mountEditor();
    const postCommand = commandButton(mounted, "post");
    expect(postCommand).toBeDefined();
    searchAvailable = false;
    await postCommand!.trigger("mousedown");
    await flushPromises();
    expect(
      mounted
        .findAll(".forum-command-option--command")
        .some((button) => button.text().includes("/post")),
    ).toBe(false);
    expect(mounted.emitted("update:modelValue")).toBeUndefined();
  });

  it("keeps the command draft synchronized through market and game selection", async () => {
    const mounted = await mountEditor();
    const editor = mounted.get<HTMLElement>(".forum-post-editor");
    const gameCommand = mounted
      .findAll(".forum-command-option--command")
      .find((button) => button.text().includes("/game"));
    await gameCommand!.trigger("mousedown");
    await flushPromises();
    expect(mounted.emitted("update:modelValue")?.at(-1)).toEqual(["/game"]);

    await mounted.get(".forum-command-option").trigger("mousedown");
    await flushPromises();
    expect(mounted.emitted("update:modelValue")?.at(-1)).toEqual([
      "/game<official>",
    ]);

    await mounted.get(".forum-command-option").trigger("mousedown");
    await flushPromises();
    expect(mounted.emitted("update:modelValue")?.at(-1)).toEqual([
      "/game<official,com.bz.demo> ",
    ]);
    expect(editor.find(".forum-reference--game").exists()).toBe(true);
  });

  it("completes market, version and page flows from the shared registry", async () => {
    let mounted = await mountEditor();
    await commandButton(mounted, "market")!.trigger("mousedown");
    await flushPromises();
    await mounted.get(".forum-command-option").trigger("mousedown");
    expect(mounted.emitted("update:modelValue")?.at(-1)).toEqual([
      "/market<official> ",
    ]);

    mounted.unmount();
    wrapper = null;
    document.body.replaceChildren();
    mounted = await mountEditor();
    await commandButton(mounted, "version")!.trigger("mousedown");
    await flushPromises();
    await mounted.get(".forum-command-option").trigger("mousedown");
    await flushPromises();
    await mounted.get(".forum-command-option").trigger("mousedown");
    await flushPromises();
    await mounted.get(".forum-command-option").trigger("mousedown");
    expect(mounted.emitted("update:modelValue")?.at(-1)).toEqual([
      "/version<official,com.bz.demo,1.0.0> ",
    ]);

    mounted.unmount();
    wrapper = null;
    document.body.replaceChildren();
    mounted = await mountEditor();
    await commandButton(mounted, "page")!.trigger("mousedown");
    await mounted.get(".forum-command-option").trigger("mousedown");
    await mounted.get(".forum-command-option").trigger("mousedown");
    expect(mounted.emitted("update:modelValue")?.at(-1)).toEqual([
      "/page<market> ",
    ]);
  });

  it("supports arrow navigation, Tab selection and Escape", async () => {
    const mounted = await mountEditor();
    const editor = mounted.get(".forum-post-editor");
    await editor.trigger("keydown", { key: "ArrowDown" });
    await editor.trigger("keydown", { key: "Tab" });
    await flushPromises();
    expect(mounted.emitted("update:modelValue")?.at(-1)).toEqual(["/version"]);
    await editor.trigger("keydown", { key: "Escape" });
    expect(mounted.find(".forum-command-popup").exists()).toBe(false);
  });

  it("deletes a selected reference and its automatic separator atomically", async () => {
    const mounted = await mountEditor();
    const editor = mounted.get<HTMLElement>(".forum-post-editor");
    await commandButton(mounted, "market")!.trigger("mousedown");
    await flushPromises();
    await mounted.get(".forum-command-option").trigger("mousedown");
    await flushPromises();
    const trailingText = editor.element.lastChild;
    expect(trailingText?.nodeType).toBe(Node.TEXT_NODE);
    const range = document.createRange();
    range.setStart(trailingText!, 1);
    range.collapse(true);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
    await editor.trigger("keydown", { key: "Backspace" });
    expect(mounted.emitted("update:modelValue")?.at(-1)).toEqual([""]);
    expect(editor.find("[data-forum-reference]").exists()).toBe(false);
  });

  it("converts completed manual and pasted commands into reference nodes", async () => {
    const mounted = await mountEditor("/market<official");
    const editor = mounted.get<HTMLElement>(".forum-post-editor");
    editor.element.textContent = "/market<official>";
    placeCaretAtEnd(editor.element);
    await editor.trigger("input");
    await flushPromises();
    expect(editor.find(".forum-reference--market").exists()).toBe(true);

    editor.element.textContent = "";
    const range = document.createRange();
    range.setStart(editor.element, 0);
    range.collapse(true);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
    await editor.trigger("paste", {
      clipboardData: {
        getData: () => "/page<market> /game<official,com.bz.demo>",
      },
    });
    await flushPromises();
    expect(editor.findAll("[data-forum-reference]")).toHaveLength(2);
  });

  it("defers command detection during IME composition", async () => {
    const mounted = await mountEditor("");
    const editor = mounted.get<HTMLElement>(".forum-post-editor");
    await editor.trigger("compositionstart");
    editor.element.textContent = "/g";
    placeCaretAtEnd(editor.element);
    await editor.trigger("input");
    expect(mounted.find(".forum-command-popup").exists()).toBe(false);
    await editor.trigger("compositionend");
    await flushPromises();
    expect(mounted.findAll(".forum-command-option--command")).toHaveLength(1);
  });

  it("supports keyboard command selection and closes on an outside click", async () => {
    const mounted = await mountEditor("/g");
    const editor = mounted.get(".forum-post-editor");
    expect(mounted.findAll(".forum-command-option--command")).toHaveLength(1);

    await editor.trigger("keydown", { key: "Enter" });
    await flushPromises();
    expect(mounted.emitted("update:modelValue")?.at(-1)).toEqual(["/game"]);
    expect(mounted.find(".forum-command-popup").exists()).toBe(true);

    document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    await flushPromises();
    expect(mounted.find(".forum-command-popup").exists()).toBe(false);
  });

  it("treats a slash typed at the same position after deletion as a new trigger", async () => {
    const mounted = await mountEditor();
    const editor = mounted.get<HTMLElement>(".forum-post-editor");
    document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    await flushPromises();
    expect(mounted.find(".forum-command-popup").exists()).toBe(false);

    editor.element.textContent = "";
    await editor.trigger("input");
    editor.element.textContent = "/";
    placeCaretAtEnd(editor.element);
    await editor.trigger("input");
    await flushPromises();
    expect(mounted.find(".forum-command-popup").exists()).toBe(true);
  });

  it("reopens a dismissed command draft when the caret returns", async () => {
    const mounted = await mountEditor("/game");
    const editor = mounted.get<HTMLElement>(".forum-post-editor");
    document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    await editor.trigger("blur");
    await flushPromises();
    expect(mounted.find(".forum-command-popup").exists()).toBe(false);

    placeCaretAtEnd(editor.element);
    await editor.trigger("focus");
    await flushPromises();
    expect(mounted.find(".forum-command-popup").exists()).toBe(true);
  });

  it("reopens a dismissed command draft after space and backspace", async () => {
    const mounted = await mountEditor("/game");
    const editor = mounted.get<HTMLElement>(".forum-post-editor");
    document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));

    editor.element.textContent = "/game ";
    placeCaretAtEnd(editor.element);
    await editor.trigger("input");
    expect(mounted.find(".forum-command-popup").exists()).toBe(false);

    editor.element.textContent = "/game";
    placeCaretAtEnd(editor.element);
    await editor.trigger("input");
    await flushPromises();
    expect(mounted.find(".forum-command-popup").exists()).toBe(true);
  });

  it("keeps a dismissed plain slash query hidden while continuing a URL-like value", async () => {
    const mounted = await mountEditor();
    const editor = mounted.get<HTMLElement>(".forum-post-editor");
    document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    await editor.trigger("blur");
    placeCaretAtEnd(editor.element);
    await editor.trigger("focus");
    await flushPromises();
    expect(mounted.find(".forum-command-popup").exists()).toBe(false);

    editor.element.textContent = "/path";
    placeCaretAtEnd(editor.element);
    await editor.trigger("input");
    await flushPromises();
    expect(mounted.find(".forum-command-popup").exists()).toBe(false);
  });
});
