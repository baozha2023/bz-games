import { UpdateManager, type UpdateInfo } from "velopack";

type DownloadRequest = {
  type: "download";
  feedUrl: string;
  update: UpdateInfo;
};

function send(payload: unknown): void {
  if (process.send) process.send(payload);
}

function finish(payload: unknown, exitCode: number): void {
  process.exitCode = exitCode;
  if (process.send) {
    process.send(payload, () => process.disconnect?.());
  } else {
    process.exit(exitCode);
  }
}

process.once("message", (message: DownloadRequest) => {
  if (
    !message ||
    message.type !== "download" ||
    typeof message.feedUrl !== "string" ||
    !message.update
  ) {
    finish({ type: "error", message: "update_worker_request_invalid" }, 1);
    return;
  }
  const manager = new UpdateManager(message.feedUrl);
  void manager
    .downloadUpdateAsync(message.update, (progress) => {
      send({ type: "progress", progress });
    })
    .then(() => {
      finish({ type: "complete" }, 0);
    })
    .catch((error: unknown) => {
      finish(
        {
          type: "error",
          message: error instanceof Error ? error.message : String(error),
        },
        1,
      );
    });
});
