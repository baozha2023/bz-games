import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import { app, dialog, nativeImage } from "electron";

import { DEFAULT_RELAY_SERVER_URL } from "../../../shared/AppConstants";
import { requestInterceptor } from "../../utils/requestInterceptor";
import { logger } from "../../utils/logger";
import { storeService } from "../storage/StoreService";
import { accountService } from "./AccountService";
import type {
  FeedbackDetail,
  FeedbackHistoryItem,
  FeedbackHistoryPage,
  FeedbackStatus,
} from "../../../shared/types";

const MAX_IMAGES = 4;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_TEXT_LENGTH = 5000;
const REQUEST_TIMEOUT_MS = 45_000;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ALLOWED_IMAGE_CONTENT_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
]);

interface FeedbackImagePreview {
  id: string;
  fileName: string;
  previewUrl: string;
}

interface FeedbackSelectionResult {
  success: boolean;
  canceled?: boolean;
  selectionId?: string;
  images?: FeedbackImagePreview[];
  error?: string;
}

type FeedbackSubmitResult =
  | {
      success: true;
      id: string;
    }
  | {
      success: false;
      error: string;
      resetAt?: string;
      message?: string;
    };

type FeedbackDetailResult =
  | { success: true; detail: FeedbackDetail }
  | { success: false; error: string; message?: string };

interface SelectedImage {
  id: string;
  fileName: string;
  contentType: string;
  sha256: string;
  buffer: Buffer;
}

interface FeedbackSelection {
  images: SelectedImage[];
  createdAt: number;
}

function normalizeRelayHttpBase(): string {
  const value = DEFAULT_RELAY_SERVER_URL.trim();
  if (!value) return "";
  if (value.startsWith("wss://")) {
    return `https://${value.slice("wss://".length)}`.replace(/\/+$/, "");
  }
  if (value.startsWith("ws://")) {
    return `http://${value.slice("ws://".length)}`.replace(/\/+$/, "");
  }
  return value.replace(/\/+$/, "");
}

function detectContentType(buffer: Buffer): string {
  if (
    buffer.length >= 8 &&
    buffer
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return "image/png";
  }
  if (
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
    return "image/jpeg";
  }
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }
  return "";
}

function getDeclaredContentType(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".png") return "image/png";
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".webp") return "image/webp";
  return "";
}

function toImagePreviews(images: SelectedImage[]): FeedbackImagePreview[] {
  return images.map((image) => ({
    id: image.id,
    fileName: image.fileName,
    previewUrl: `data:${image.contentType};base64,${image.buffer.toString(
      "base64",
    )}`,
  }));
}

function isFeedbackStatus(value: unknown): value is FeedbackStatus {
  return ["new", "reviewing", "planned", "resolved", "closed"].includes(
    String(value),
  );
}

export class FeedbackService {
  private readonly selections = new Map<string, FeedbackSelection>();
  private readonly baseUrl = normalizeRelayHttpBase();

  constructor() {
    setInterval(() => this.cleanupSelections(), 10 * 60 * 1000).unref();
  }

  private cleanupSelections(now = Date.now()) {
    for (const [selectionId, selection] of this.selections) {
      if (now - selection.createdAt > 30 * 60 * 1000) {
        this.selections.delete(selectionId);
      }
    }
  }

  async selectImages(
    existingSelectionId?: unknown,
  ): Promise<FeedbackSelectionResult> {
    if (!storeService.getSettings().accountSessionToken) {
      return { success: false, error: "unauthorized" };
    }
    const requestedSelectionId =
      typeof existingSelectionId === "string" ? existingSelectionId : "";
    const existingSelection = requestedSelectionId
      ? this.selections.get(requestedSelectionId)
      : undefined;
    if (requestedSelectionId && !existingSelection) {
      return { success: false, error: "feedback_images_expired" };
    }
    if ((existingSelection?.images.length || 0) >= MAX_IMAGES) {
      return { success: false, error: "too_many_images" };
    }

    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: "Select feedback images",
      properties: ["openFile", "multiSelections"],
      filters: [
        {
          name: "Images",
          extensions: ["png", "jpg", "jpeg", "webp"],
        },
      ],
    });
    if (canceled || filePaths.length === 0) {
      return { success: true, canceled: true };
    }
    if (
      (existingSelection?.images.length || 0) + filePaths.length >
      MAX_IMAGES
    ) {
      return { success: false, error: "too_many_images" };
    }

    try {
      const images = await Promise.all(
        filePaths.map(async (filePath) => {
          const stat = await fs.stat(filePath);
          if (!stat.isFile() || stat.size <= 0) {
            throw new Error("invalid_image");
          }
          if (stat.size > MAX_IMAGE_BYTES) {
            throw new Error("image_too_large");
          }
          const buffer = await fs.readFile(filePath);
          if (buffer.length > MAX_IMAGE_BYTES) {
            throw new Error("image_too_large");
          }
          const contentType = detectContentType(buffer);
          if (!contentType || nativeImage.createFromBuffer(buffer).isEmpty()) {
            throw new Error("unsupported_image_type");
          }
          if (contentType !== getDeclaredContentType(filePath)) {
            throw new Error("image_type_mismatch");
          }
          return {
            id: crypto.randomUUID(),
            fileName: path.basename(filePath).slice(0, 255),
            contentType,
            sha256: crypto.createHash("sha256").update(buffer).digest("hex"),
            buffer,
          };
        }),
      );
      const hashes = new Set(
        (existingSelection?.images || []).map((image) => image.sha256),
      );
      for (const image of images) {
        if (hashes.has(image.sha256)) {
          throw new Error("duplicate_image");
        }
        hashes.add(image.sha256);
      }

      const selectionId = requestedSelectionId || crypto.randomUUID();
      const combinedImages = [...(existingSelection?.images || []), ...images];
      this.selections.set(selectionId, {
        images: combinedImages,
        createdAt: Date.now(),
      });
      return {
        success: true,
        selectionId,
        images: toImagePreviews(combinedImages),
      };
    } catch (error) {
      const code =
        error instanceof Error ? error.message : "feedback_image_failed";
      logger.warn("[FeedbackService] Failed to select images", error);
      return { success: false, error: code };
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
    if (selection.images.length === 0) {
      this.selections.delete(selectionId);
    } else {
      selection.createdAt = Date.now();
    }
  }

  async getHistory(cursor = ""): Promise<FeedbackHistoryPage> {
    const settings = storeService.getSettings();
    if (!settings.accountSessionToken || !this.baseUrl) {
      return { items: [], nextCursor: null, hasMore: false };
    }

    const url = new URL(`${this.baseUrl}/api/v1/feedback`);
    url.searchParams.set("limit", "10");
    if (cursor) url.searchParams.set("cursor", cursor);
    const requestUrl = url.toString();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(requestUrl, {
        headers: requestInterceptor.buildHeaders(requestUrl, {
          Authorization: `Bearer ${settings.accountSessionToken}`,
        }),
        signal: controller.signal,
      });
      const body = (await response.json().catch(() => ({}))) as {
        items?: unknown;
        nextCursor?: unknown;
        hasMore?: unknown;
        error?: string;
      };
      accountService.handleAuthFailure(body.error);
      if (!response.ok) {
        throw new Error(body.error || `feedback_http_${response.status}`);
      }
      if (
        !Array.isArray(body.items) ||
        typeof body.hasMore !== "boolean" ||
        (body.nextCursor !== null && typeof body.nextCursor !== "string") ||
        (body.hasMore && !body.nextCursor) ||
        (!body.hasMore && body.nextCursor !== null)
      ) {
        throw new Error("feedback_invalid_response");
      }

      const items = body.items.map((item) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) {
          throw new Error("feedback_invalid_response");
        }
        const value = item as Record<string, unknown>;
        if (
          typeof value.id !== "string" ||
          !UUID_PATTERN.test(value.id) ||
          typeof value.submittedAt !== "number" ||
          !Number.isInteger(value.submittedAt) ||
          !Number.isFinite(value.submittedAt) ||
          value.submittedAt <= 0
        ) {
          throw new Error("feedback_invalid_response");
        }
        return {
          id: value.id,
          submittedAt: value.submittedAt,
        } satisfies FeedbackHistoryItem;
      });
      return {
        items,
        nextCursor: body.nextCursor,
        hasMore: body.hasMore,
      };
    } catch (error) {
      logger.warn("[FeedbackService] Failed to load feedback history", error);
      throw new Error(
        error instanceof Error && error.name === "AbortError"
          ? "feedback_timeout"
          : error instanceof Error && /^[a-z][a-z0-9_]+$/.test(error.message)
            ? error.message
            : "feedback_network_failed",
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  async getDetail(feedbackId: unknown): Promise<FeedbackDetailResult> {
    if (!storeService.getSettings().accountSessionToken) {
      return { success: false, error: "unauthorized" };
    }
    const id = typeof feedbackId === "string" ? feedbackId.trim() : "";
    if (!UUID_PATTERN.test(id)) {
      return { success: false, error: "invalid_feedback_id" };
    }
    if (!this.baseUrl) {
      return { success: false, error: "feedback_not_configured" };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const settings = storeService.getSettings();
      const authorization = settings.accountSessionToken
        ? { Authorization: `Bearer ${settings.accountSessionToken}` }
        : undefined;
      const detailUrl = `${this.baseUrl}/api/v1/feedback/${encodeURIComponent(id)}`;
      const response = await fetch(detailUrl, {
        headers: requestInterceptor.buildHeaders(detailUrl, authorization),
        signal: controller.signal,
      });
      const body = (await response.json().catch(() => ({}))) as Record<
        string,
        unknown
      >;
      accountService.handleAuthFailure(
        typeof body.error === "string" ? body.error : undefined,
      );
      if (!response.ok) {
        return {
          success: false,
          error:
            typeof body.error === "string"
              ? body.error
              : `feedback_http_${response.status}`,
          message: typeof body.message === "string" ? body.message : undefined,
        };
      }
      if (
        body.id !== id ||
        typeof body.content !== "string" ||
        body.content.length > MAX_TEXT_LENGTH ||
        !isFeedbackStatus(body.status) ||
        typeof body.reply !== "string" ||
        body.reply.length > MAX_TEXT_LENGTH ||
        !Number.isInteger(body.imageCount) ||
        (body.imageCount as number) < 0 ||
        (body.imageCount as number) > MAX_IMAGES ||
        typeof body.createdAt !== "string" ||
        !Number.isFinite(Date.parse(body.createdAt)) ||
        typeof body.updatedAt !== "string" ||
        !Number.isFinite(Date.parse(body.updatedAt)) ||
        !Array.isArray(body.images) ||
        body.images.length !== body.imageCount
      ) {
        return { success: false, error: "feedback_invalid_response" };
      }

      const images = await Promise.all(
        body.images.map(async (rawImage) => {
          const image = rawImage as Record<string, unknown>;
          if (
            typeof image.id !== "string" ||
            !UUID_PATTERN.test(image.id) ||
            typeof image.fileName !== "string" ||
            !image.fileName.trim() ||
            image.fileName.length > 255 ||
            typeof image.contentType !== "string" ||
            !ALLOWED_IMAGE_CONTENT_TYPES.has(image.contentType) ||
            !Number.isInteger(image.size) ||
            (image.size as number) <= 0 ||
            (image.size as number) > MAX_IMAGE_BYTES
          ) {
            throw new Error("feedback_invalid_response");
          }
          const imageUrl = `${detailUrl}/images/${encodeURIComponent(image.id)}`;
          const imageResponse = await fetch(imageUrl, {
            headers: requestInterceptor.buildHeaders(imageUrl, authorization),
            signal: controller.signal,
          });
          if (!imageResponse.ok) {
            const errorBody = (await imageResponse
              .json()
              .catch(() => ({}))) as Record<string, unknown>;
            accountService.handleAuthFailure(
              typeof errorBody.error === "string" ? errorBody.error : undefined,
            );
            throw new Error(
              typeof errorBody.error === "string"
                ? errorBody.error
                : `feedback_http_${imageResponse.status}`,
            );
          }
          const buffer = Buffer.from(await imageResponse.arrayBuffer());
          if (!buffer.length || buffer.length > MAX_IMAGE_BYTES) {
            throw new Error("feedback_invalid_response");
          }
          const contentType = imageResponse.headers
            .get("content-type")
            ?.split(";", 1)[0]
            .trim();
          if (
            !contentType ||
            !ALLOWED_IMAGE_CONTENT_TYPES.has(contentType) ||
            contentType !== image.contentType ||
            buffer.length !== image.size
          ) {
            throw new Error("feedback_invalid_response");
          }
          return {
            id: image.id,
            fileName: image.fileName,
            contentType,
            size: buffer.length,
            previewUrl: `data:${contentType};base64,${buffer.toString("base64")}`,
          };
        }),
      );

      return {
        success: true,
        detail: {
          id,
          content: body.content,
          status: body.status,
          reply: body.reply,
          imageCount: body.imageCount as number,
          createdAt: body.createdAt,
          updatedAt: body.updatedAt,
          images,
        },
      };
    } catch (error) {
      logger.warn("[FeedbackService] Failed to load feedback detail", error);
      return {
        success: false,
        error:
          error instanceof Error && error.name === "AbortError"
            ? "feedback_timeout"
            : error instanceof Error && /^[a-z][a-z0-9_]+$/.test(error.message)
              ? error.message
              : "feedback_network_failed",
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  async submit(payload: unknown): Promise<FeedbackSubmitResult> {
    const settings = storeService.getSettings();
    if (!settings.accountSessionToken) {
      return { success: false, error: "unauthorized" };
    }
    if (!this.baseUrl) {
      return { success: false, error: "feedback_not_configured" };
    }
    if (!payload || typeof payload !== "object") {
      return { success: false, error: "invalid_feedback" };
    }
    const input = payload as { content?: unknown; selectionId?: unknown };
    const rawContent = typeof input.content === "string" ? input.content : "";
    const content = rawContent.trim();
    if (content.length > MAX_TEXT_LENGTH) {
      return { success: false, error: "feedback_text_too_long" };
    }
    const selectionId =
      typeof input.selectionId === "string" ? input.selectionId : "";
    const selection = selectionId ? this.selections.get(selectionId) : null;
    if (selectionId && !selection) {
      return { success: false, error: "feedback_images_expired" };
    }
    if (!content && !selection?.images.length) {
      return { success: false, error: "feedback_empty" };
    }

    const url = `${this.baseUrl}/api/v1/feedback`;
    const form = new FormData();
    form.set("content", content);
    form.set("appVersion", app.getVersion());
    form.set("platform", process.platform);
    for (const image of selection?.images || []) {
      form.append(
        "images",
        new Blob([new Uint8Array(image.buffer)], {
          type: image.contentType,
        }),
        image.fileName,
      );
    }

    const headers = requestInterceptor.buildHeaders(url, {
      Authorization: `Bearer ${settings.accountSessionToken}`,
    });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers,
        body: form,
        signal: controller.signal,
      });
      const body = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        id?: string;
        resetAt?: string;
        error?: string;
        message?: string;
      };
      accountService.handleAuthFailure(body.error);
      if (!response.ok) {
        return {
          success: false,
          error: body.error || `feedback_http_${response.status}`,
          resetAt: body.resetAt,
          message: body.message,
        };
      }
      if (body.ok !== true || typeof body.id !== "string" || !body.id.trim()) {
        return { success: false, error: "feedback_invalid_response" };
      }
      const feedbackId = body.id.trim();
      if (selectionId) this.selections.delete(selectionId);
      return {
        success: true,
        id: feedbackId,
      };
    } catch (error) {
      logger.warn("[FeedbackService] Submit failed", error);
      return {
        success: false,
        error:
          error instanceof Error && error.name === "AbortError"
            ? "feedback_timeout"
            : "feedback_network_failed",
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}

export const feedbackService = new FeedbackService();
