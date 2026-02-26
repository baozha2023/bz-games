import { playAchievementSound } from "./sound";

type AchievementJob = {
  gameId: string;
  version: string;
  achievementId: string;
};

export class AchievementNotifier {
  private queue: AchievementJob[] = [];
  private timer: number | null = null;
  private processing = false;
  private readonly delayMs: number;
  private readonly onProcess: (job: AchievementJob) => Promise<void> | void;

  constructor({
    delayMs = 5200,
    onProcess,
  }: {
    delayMs?: number;
    onProcess: (job: AchievementJob) => Promise<void> | void;
  }) {
    this.delayMs = delayMs;
    this.onProcess = onProcess;
  }

  enqueue(job: AchievementJob) {
    this.queue.push(job);
    if (!this.processing) {
      this.processNext();
    }
  }

  dispose() {
    if (this.timer) {
      window.clearTimeout(this.timer);
      this.timer = null;
    }
    this.queue = [];
    this.processing = false;
  }

  private async processNext() {
    if (this.queue.length === 0) {
      this.processing = false;
      return;
    }
    this.processing = true;
    const job = this.queue.shift();
    if (!job) {
      this.processing = false;
      return;
    }
    playAchievementSound();
    await this.onProcess(job);
    this.timer = window.setTimeout(() => {
      this.timer = null;
      this.processNext();
    }, this.delayMs);
  }
}
