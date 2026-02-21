import {app} from 'electron';
import path from 'path';

/**
 * Get the application root directory.
 * - Development: The project root directory (where package.json is).
 * - Production: The directory containing the executable.
 */
export function getAppRoot(): string {
    if (app.isPackaged) {
        return path.dirname(app.getPath('exe'));
    } else {
        // In dev mode (electron-vite), process.cwd() is the project root
        return process.cwd();
    }
}

/**
 * Get the directory where game files should be stored.
 */
export function getGamesDir(): string {
    return path.join(getAppRoot(), 'games');
}
