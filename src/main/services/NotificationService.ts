import {BrowserWindow, screen} from 'electron';
import path from 'path';
import {is} from '@electron-toolkit/utils';
import {logger} from '../utils/logger';
import {storeService} from './StoreService';

class NotificationService {
    private window: BrowserWindow | null = null;
    private closeTimeout: NodeJS.Timeout | null = null;

    show(title: string, description: string, gameName: string, icon?: string) {
        if (this.window) {
            if (this.closeTimeout) clearTimeout(this.closeTimeout);
            try {
                this.window.close();
            } catch (e) {
            }
            this.window = null;
        }

        const primaryDisplay = screen.getPrimaryDisplay();
        const {workArea} = primaryDisplay;

        const width = 300;
        const height = 64;
        const margin = 0;

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
            focusable: false,
            webPreferences: {
                preload: path.join(__dirname, '../preload/index.js'),
                sandbox: false,
                nodeIntegration: false,
                contextIsolation: true,
            },
            show: false
        });

        this.window.setIgnoreMouseEvents(false);

        const settings = storeService.getSettings();
        const theme = settings.theme || 'dark';

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

        this.closeTimeout = setTimeout(() => {
            if (this.window) {
                this.window.close();
                this.window = null;
            }
        }, 5000);
    }
}

export const notificationService = new NotificationService();