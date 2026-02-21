import { BrowserWindow, screen } from 'electron';
import path from 'path';
import { is } from '@electron-toolkit/utils';
import { logger } from '../utils/logger';
import { storeService } from './StoreService';

class NotificationService {
  private window: BrowserWindow | null = null;
  private closeTimeout: NodeJS.Timeout | null = null;

  show(title: string, description: string, gameName: string, icon?: string) {
    // If a notification is already showing, close it immediately to show the new one
    if (this.window) {
      if (this.closeTimeout) clearTimeout(this.closeTimeout);
      try {
        this.window.close();
      } catch (e) {
        // Ignore if already closed
      }
      this.window = null;
    }

    const primaryDisplay = screen.getPrimaryDisplay();
    const { workArea } = primaryDisplay;
    
    // Notification dimensions
    const width = 300;
    const height = 64; // More compact
    const margin = 12;

    const x = workArea.x + workArea.width - width - margin;
    const y = workArea.y + workArea.height - height - margin;

    this.window = new BrowserWindow({
      width,
      height,
      x,
      y,
      frame: false,
      transparent: true,
      resizable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      focusable: false, // Do not take focus
      webPreferences: {
        preload: path.join(__dirname, '../preload/index.js'),
        sandbox: false,
        nodeIntegration: false,
        contextIsolation: true,
      },
      show: false // Show after ready-to-show
    });

    this.window.setIgnoreMouseEvents(false); // Allow clicking if needed, or true for click-through

    const settings = storeService.getSettings();
    const theme = settings.theme || 'dark';

    // Construct URL with query params
    const params = new URLSearchParams({
      title,
      description,
      gameName,
      icon: icon || '',
      theme
    });

    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
      this.window.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/#/notification?${params.toString()}`);
    } else {
      this.window.loadFile(path.join(__dirname, '../renderer/index.html'), {
        hash: `/notification?${params.toString()}`
      });
    }

    this.window.once('ready-to-show', () => {
      this.window?.showInactive();
      logger.info('[NotificationService] Notification shown');
    });

    // Auto close after 5 seconds
    this.closeTimeout = setTimeout(() => {
      if (this.window) {
        // Optional: Fade out animation logic could go here
        this.window.close();
        this.window = null;
      }
    }, 5000);
  }
}

export const notificationService = new NotificationService();