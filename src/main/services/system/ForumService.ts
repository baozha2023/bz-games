import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import { dialog, nativeImage } from "electron";

import { DEFAULT_RELAY_SERVER_URL } from "../../../shared/AppConstants";
import type {
  ForumComment,
  ForumImage,
  ForumImageSelection,
  ForumImageSelectionResult,
  ForumMutationResult,
  ForumPage,
  ForumPostDetail,
  ForumPostSummary,
  ForumPostReference,
  ForumPostReferenceResult,
} from "../../../shared/types";
import { requestInterceptor } from "../../utils/requestInterceptor";
import { logger } from "../../utils/logger";
import { storeService } from "../storage/StoreService";
import { accountService } from "./AccountService";

const MAX_IMAGES = 4;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_IMAGE_DIMENSION = 16_384;
const MAX_IMAGE_PIXELS = 40_000_000;
const ALLOWED_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface SelectedImage extends ForumImageSelection {
  contentType: string;
  buffer: Buffer;
  sha256: string;
}

function normalizeBaseUrl(): string {
  const value = DEFAULT_RELAY_SERVER_URL.trim();
  if (value.startsWith("wss://"))
    return `https://${value.slice(6)}`.replace(/\/+$/, "");
  if (value.startsWith("ws://"))
    return `http://${value.slice(5)}`.replace(/\/+$/, "");
  return value.replace(/\/+$/, "");
}

function detectType(buffer: Buffer): string {
  if (
    buffer
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  )
    return "image/png";
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff)
    return "image/jpeg";
  if (
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP"
  )
    return "image/webp";
  return "";
}

function declaredType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  return "";
}

function errorCode(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : "forum_request_failed";
}

function assertUuid(value: string): string {
  if (!UUID_PATTERN.test(value)) throw new Error("invalid_forum_id");
  return value;
}

function isForumImage(value: unknown): value is ForumImage {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const image = value as Record<string, unknown>;
  return (
    typeof image.id === "string" &&
    UUID_PATTERN.test(image.id) &&
    typeof image.fileName === "string" &&
    Boolean(image.fileName.trim()) &&
    image.fileName.length <= 255 &&
    typeof image.contentType === "string" &&
    ALLOWED_TYPES.has(image.contentType) &&
    Number.isInteger(image.size) &&
    Number(image.size) > 0 &&
    Number(image.size) <= MAX_IMAGE_BYTES &&
    Number.isInteger(image.width) &&
    Number.isInteger(image.height) &&
    Number(image.width) > 0 &&
    Number(image.height) > 0 &&
    Number(image.width) <= MAX_IMAGE_DIMENSION &&
    Number(image.height) <= MAX_IMAGE_DIMENSION &&
    Number(image.width) * Number(image.height) <= MAX_IMAGE_PIXELS
  );
}

function isForumPostReference(
  value: unknown,
  requestedIds: ReadonlySet<string>,
): value is ForumPostReference {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  if (
    typeof item.id !== "string" ||
    !UUID_PATTERN.test(item.id) ||
    !requestedIds.has(item.id) ||
    (item.status !== "active" &&
      item.status !== "deleted" &&
      item.status !== "missing")
  )
    return false;
  return (
    item.status !== "active" ||
    (typeof item.title === "string" && typeof item.body === "string")
  );
}

function isForumPostReferenceResult(
  value: unknown,
  requestedIds: string[],
): value is ForumPostReferenceResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const items = (value as Record<string, unknown>).items;
  if (!Array.isArray(items) || items.length !== requestedIds.length)
    return false;
  const requested = new Set(requestedIds);
  const seen = new Set<string>();
  return items.every((item) => {
    if (!isForumPostReference(item, requested) || seen.has(item.id))
      return false;
    seen.add(item.id);
    return true;
  });
}

export class ForumService {
  private readonly baseUrl = normalizeBaseUrl();
  private readonly selections = new Map<
    string,
    { images: SelectedImage[]; createdAt: number }
  >();

  constructor() {
    setInterval(() => this.cleanupSelections(), 10 * 60 * 1000).unref();
  }

  private cleanupSelections() {
    const cutoff = Date.now() - 30 * 60 * 1000;
    for (const [id, selection] of this.selections) {
      if (selection.createdAt < cutoff) this.selections.delete(id);
    }
  }

  private token(): string {
    return storeService.getSettings().accountSessionToken?.trim() || "";
  }

  private async request<T = unknown>(
    pathname: string,
    init: RequestInit = {},
  ): Promise<T> {
    if (!this.baseUrl) throw new Error("forum_not_configured");
    const token = this.token();
    if (!token) throw new Error("unauthorized");
    const url = `${this.baseUrl}${pathname}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    try {
      const response = await fetch(url, {
        ...init,
        headers: requestInterceptor.buildHeaders(url, {
          ...(init.body instanceof FormData
            ? {}
            : { "content-type": "application/json" }),
          Authorization: `Bearer ${token}`,
          ...(init.headers as Record<string, string> | undefined),
        }),
        signal: controller.signal,
      });
      const body = (await response.json().catch(() => ({}))) as Record<
        string,
        unknown
      >;
      accountService.handleAuthFailure(
        typeof body.error === "string" ? body.error : undefined,
      );
      if (!response.ok)
        throw new Error(
          typeof body.error === "string"
            ? body.error
            : `forum_http_${response.status}`,
        );
      return body as T;
    } finally {
      clearTimeout(timeout);
    }
  }

  async selectImages(
    existingSelectionId?: unknown,
  ): Promise<ForumImageSelectionResult> {
    if (!this.token()) return { success: false, error: "unauthorized" };
    const requested =
      typeof existingSelectionId === "string" ? existingSelectionId : "";
    const existing = requested ? this.selections.get(requested) : undefined;
    if (requested && !existing)
      return { success: false, error: "forum_images_expired" };
    if ((existing?.images.length || 0) >= MAX_IMAGES)
      return { success: false, error: "too_many_images" };
    const result = await dialog.showOpenDialog({
      title: "选择论坛图片",
      properties: ["openFile", "multiSelections"],
      filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp"] }],
    });
    if (result.canceled || result.filePaths.length === 0)
      return { success: true, canceled: true };
    if ((existing?.images.length || 0) + result.filePaths.length > MAX_IMAGES)
      return { success: false, error: "too_many_images" };
    try {
      const additions: SelectedImage[] = [];
      for (const filePath of result.filePaths) {
        const stat = await fs.stat(filePath);
        if (!stat.isFile() || stat.size <= 0) throw new Error("invalid_image");
        if (stat.size > MAX_IMAGE_BYTES) throw new Error("image_too_large");
        const buffer = await fs.readFile(filePath);
        if (!buffer.length || buffer.length > MAX_IMAGE_BYTES)
          throw new Error("image_too_large");
        const contentType = detectType(buffer);
        const decoded = nativeImage.createFromBuffer(buffer);
        const dimensions = decoded.getSize();
        if (
          !ALLOWED_TYPES.has(contentType) ||
          contentType !== declaredType(filePath) ||
          decoded.isEmpty() ||
          !Number.isInteger(dimensions.width) ||
          !Number.isInteger(dimensions.height) ||
          dimensions.width <= 0 ||
          dimensions.height <= 0 ||
          dimensions.width > MAX_IMAGE_DIMENSION ||
          dimensions.height > MAX_IMAGE_DIMENSION ||
          dimensions.width * dimensions.height > MAX_IMAGE_PIXELS
        )
          throw new Error("invalid_image");
        additions.push({
          id: crypto.randomUUID(),
          fileName: path.basename(filePath).slice(0, 255),
          previewUrl: `data:${contentType};base64,${buffer.toString("base64")}`,
          contentType,
          buffer,
          sha256: crypto.createHash("sha256").update(buffer).digest("hex"),
        });
      }
      const hashes = new Set(
        (existing?.images || []).map((item) => item.sha256),
      );
      for (const image of additions) {
        if (hashes.has(image.sha256)) throw new Error("duplicate_image");
        hashes.add(image.sha256);
      }
      const selectionId = requested || crypto.randomUUID();
      const images = [...(existing?.images || []), ...additions];
      this.selections.set(selectionId, { images, createdAt: Date.now() });
      return {
        success: true,
        selectionId,
        images: images.map(({ id, fileName, previewUrl }) => ({
          id,
          fileName,
          previewUrl,
        })),
      };
    } catch (error) {
      logger.warn("[ForumService] Failed to select images", error);
      return { success: false, error: errorCode(error) };
    }
  }

  releaseImages(selectionId: unknown, imageId?: unknown): void {
    if (typeof selectionId !== "string") return;
    if (typeof imageId !== "string") {
      this.selections.delete(selectionId);
      return;
    }
    const selection = this.selections.get(selectionId);
    if (!selection) return;
    selection.images = selection.images.filter((image) => image.id !== imageId);
    selection.createdAt = Date.now();
    if (!selection.images.length) this.selections.delete(selectionId);
  }

  async listPosts(
    query = "",
    cursor = "",
  ): Promise<ForumPage<ForumPostSummary>> {
    const params = new URLSearchParams({ limit: "10" });
    if (query.trim()) params.set("q", query.trim());
    if (cursor) params.set("cursor", cursor);
    return this.request<ForumPage<ForumPostSummary>>(
      `/api/v1/forum/posts?${params}`,
    );
  }

  async getSearchAvailability(): Promise<boolean> {
    try {
      const result = await this.request<{ enabled?: unknown }>(
        "/api/v1/forum/search-status",
      );
      return result?.enabled === true;
    } catch {
      return false;
    }
  }

  async getPost(postId: string): Promise<ForumPostDetail> {
    const id = assertUuid(postId);
    const detail = await this.request<ForumPostDetail>(
      `/api/v1/forum/posts/${encodeURIComponent(id)}`,
    );
    if (
      !detail ||
      typeof detail !== "object" ||
      !Array.isArray(detail.images) ||
      detail.images.length > MAX_IMAGES
    ) {
      throw new Error("forum_invalid_response");
    }
    const images = await Promise.all(
      detail.images.map((image) => this.loadImage(id, image)),
    );
    return { ...detail, images };
  }

  async resolvePostReferences(
    ids: string[],
  ): Promise<ForumPostReferenceResult> {
    const uniqueIds = [...new Set(ids.map((id) => assertUuid(id)))];
    if (uniqueIds.length > 20)
      throw new Error("too_many_forum_post_references");
    const result = await this.request<ForumPostReferenceResult>(
      "/api/v1/forum/post-references/resolve",
      {
        method: "POST",
        body: JSON.stringify({ ids: uniqueIds }),
      },
    );
    if (!isForumPostReferenceResult(result, uniqueIds))
      throw new Error("forum_invalid_response");
    return result;
  }

  private async loadImage(postId: string, image: unknown): Promise<ForumImage> {
    if (!isForumImage(image)) throw new Error("forum_invalid_response");
    const url = `${this.baseUrl}/api/v1/forum/posts/${encodeURIComponent(postId)}/images/${encodeURIComponent(image.id)}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    try {
      const response = await fetch(url, {
        headers: requestInterceptor.buildHeaders(url, {
          Authorization: `Bearer ${this.token()}`,
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        accountService.handleAuthFailure(
          typeof body?.error === "string" ? body.error : undefined,
        );
        throw new Error(
          typeof body?.error === "string"
            ? body.error
            : "forum_image_load_failed",
        );
      }
      const buffer = Buffer.from(await response.arrayBuffer());
      const contentType = response.headers
        .get("content-type")
        ?.split(";", 1)[0]
        .trim();
      const decoded = nativeImage.createFromBuffer(buffer);
      const dimensions = decoded.getSize();
      if (
        contentType !== image.contentType ||
        detectType(buffer) !== image.contentType ||
        buffer.length !== image.size ||
        buffer.length > MAX_IMAGE_BYTES ||
        decoded.isEmpty() ||
        dimensions.width !== image.width ||
        dimensions.height !== image.height
      ) {
        throw new Error("forum_invalid_response");
      }
      return {
        ...image,
        previewUrl: `data:${contentType};base64,${buffer.toString("base64")}`,
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  async getComments(
    postId: string,
    cursor = "",
  ): Promise<ForumPage<ForumComment>> {
    const id = assertUuid(postId);
    const params = new URLSearchParams({ limit: "10" });
    if (cursor) params.set("cursor", cursor);
    return this.request<ForumPage<ForumComment>>(
      `/api/v1/forum/posts/${encodeURIComponent(id)}/comments?${params}`,
    );
  }

  async createPost(payload: {
    title: string;
    body: string;
    selectionId?: string;
  }): Promise<ForumMutationResult> {
    const selection = payload.selectionId
      ? this.selections.get(payload.selectionId)
      : undefined;
    if (payload.selectionId && !selection)
      return { success: false, error: "forum_images_expired" };
    const form = new FormData();
    form.set("title", payload.title);
    form.set("body", payload.body);
    for (const image of selection?.images || []) {
      const bytes = image.buffer.buffer.slice(
        image.buffer.byteOffset,
        image.buffer.byteOffset + image.buffer.byteLength,
      ) as ArrayBuffer;
      form.append(
        "images",
        new Blob([bytes], { type: image.contentType }),
        image.fileName,
      );
    }
    try {
      const response = await this.request<{ id?: unknown }>(
        "/api/v1/forum/posts",
        {
          method: "POST",
          body: form,
        },
      );
      if (
        !response ||
        typeof response.id !== "string" ||
        !UUID_PATTERN.test(response.id)
      ) {
        throw new Error("forum_invalid_response");
      }
      if (payload.selectionId) this.selections.delete(payload.selectionId);
      return { success: true, id: response.id };
    } catch (error) {
      return { success: false, error: errorCode(error) };
    }
  }

  async createComment(
    postId: string,
    content: string,
  ): Promise<ForumMutationResult> {
    try {
      const response = await this.request<{ id?: unknown }>(
        `/api/v1/forum/posts/${encodeURIComponent(assertUuid(postId))}/comments`,
        { method: "POST", body: JSON.stringify({ content }) },
      );
      if (
        !response ||
        typeof response.id !== "string" ||
        !UUID_PATTERN.test(response.id)
      )
        throw new Error("forum_invalid_response");
      return { success: true, id: response.id };
    } catch (error) {
      return { success: false, error: errorCode(error) };
    }
  }

  async deletePost(postId: string): Promise<ForumMutationResult> {
    try {
      await this.request(
        `/api/v1/forum/posts/${encodeURIComponent(assertUuid(postId))}`,
        { method: "DELETE" },
      );
      return { success: true };
    } catch (error) {
      return { success: false, error: errorCode(error) };
    }
  }

  async deleteComment(commentId: string): Promise<ForumMutationResult> {
    try {
      await this.request(
        `/api/v1/forum/comments/${encodeURIComponent(assertUuid(commentId))}`,
        { method: "DELETE" },
      );
      return { success: true };
    } catch (error) {
      return { success: false, error: errorCode(error) };
    }
  }

  async togglePostLike(
    postId: string,
    liked: boolean,
  ): Promise<ForumMutationResult> {
    return this.toggleLike("posts", postId, liked);
  }

  async toggleCommentLike(
    commentId: string,
    liked: boolean,
  ): Promise<ForumMutationResult> {
    return this.toggleLike("comments", commentId, liked);
  }

  private async toggleLike(
    type: "posts" | "comments",
    id: string,
    liked: boolean,
  ): Promise<ForumMutationResult> {
    try {
      const response = await this.request<{
        liked?: unknown;
        likeCount?: unknown;
      }>(`/api/v1/forum/${type}/${encodeURIComponent(assertUuid(id))}/like`, {
        method: liked ? "PUT" : "DELETE",
      });
      if (
        !response ||
        typeof response.liked !== "boolean" ||
        typeof response.likeCount !== "number" ||
        !Number.isInteger(response.likeCount) ||
        response.likeCount < 0
      ) {
        throw new Error("forum_invalid_response");
      }
      return {
        success: true,
        liked: response.liked,
        likeCount: response.likeCount,
      };
    } catch (error) {
      return { success: false, error: errorCode(error) };
    }
  }
}

export const forumService = new ForumService();
