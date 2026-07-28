import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import { app, dialog, nativeImage } from "electron";

import { DEFAULT_RELAY_SERVER_URL } from "../../../shared/AppConstants";
import { requestInterceptor } from "../../utils/requestInterceptor";
import { logger } from "../../utils/logger";
import { storeService } from "../storage/StoreService";
import type { FeedbackHistoryItem } from "../../../shared/types";

const MAX_IMAGES = 4;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_TEXT_LENGTH = 5000;
const REQUEST_TIMEOUT_MS = 45_000;

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
    };

interface SelectedImage {
  id: string;
  fileName: string;
  contentType: string;
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

class FeedbackService {
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

  async selectImages(): Promise<FeedbackSelectionResult> {
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
    if (filePaths.length > MAX_IMAGES) {
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
          return {
            id: crypto.randomUUID(),
            fileName: path.basename(filePath).slice(0, 255),
            contentType,
            buffer,
          };
        }),
      );
      const selectionId = crypto.randomUUID();
      this.selections.set(selectionId, {
        images,
        createdAt: Date.now(),
      });
      return {
        success: true,
        selectionId,
        images: images.map((image) => ({
          id: image.id,
          fileName: image.fileName,
          previewUrl: `data:${image.contentType};base64,${image.buffer.toString(
            "base64",
          )}`,
        })),
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
    if (selection.images.length === 0) this.selections.delete(selectionId);
  }

  getHistory(): FeedbackHistoryItem[] {
    try {
      return storeService.getFeedbackHistory();
    } catch (error) {
      logger.warn("[FeedbackService] Failed to read feedback history", error);
      return [];
    }
  }

  async submit(payload: unknown): Promise<FeedbackSubmitResult> {
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
    const settings = storeService.getSettings();
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

    const headers = requestInterceptor.buildHeaders(
      url,
      settings.cloudSessionToken
        ? { Authorization: `Bearer ${settings.cloudSessionToken}` }
        : undefined,
    );
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
      };
      if (response.status === 401 && settings.cloudSessionToken) {
        storeService.saveSettings({
          cloudSessionToken: "",
          cloudSessionExpiresAt: "",
          cloudUserLogin: "",
          cloudUserName: "",
          cloudUserProfileUrl: "",
        });
      }
      if (!response.ok) {
        return {
          success: false,
          error: body.error || `feedback_http_${response.status}`,
          resetAt: body.resetAt,
        };
      }
      if (body.ok !== true || typeof body.id !== "string" || !body.id.trim()) {
        return { success: false, error: "feedback_invalid_response" };
      }
      const feedbackId = body.id.trim();
      if (selectionId) this.selections.delete(selectionId);
      try {
        storeService.addFeedbackHistory(feedbackId);
      } catch (error) {
        logger.warn("[FeedbackService] Failed to save feedback history", error);
      }
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
