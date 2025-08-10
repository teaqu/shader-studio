import { app, BrowserWindow, Menu, nativeImage, nativeTheme, MenuItem } from 'electron';
import * as path from 'path';
import * as fs from 'fs';

app.setName('Shader Studio');
if (process.platform === 'darwin') {
    process.title = 'Shader Studio';
}

interface WindowBounds {
    width: number;
    height: number;
    x?: number;
    y?: number;
}

interface Settings {
    alwaysOnTop: boolean;
    theme: 'system' | 'light' | 'dark';
    windowBounds: WindowBounds;
}

let win: BrowserWindow;
let settings: Settings = {
    alwaysOnTop: process.argv.includes('--alwaysOnTop'),
    theme: 'system',
    windowBounds: {
        width: 800,
        height: 600,
        x: undefined,
        y: undefined
    }
};

const settingsPath: string = path.join(app.getPath('userData'), 'settings.json');

function loadSettings(): void {
    try {
        if (fs.existsSync(settingsPath)) {
            const savedSettings = JSON.parse(fs.readFileSync(settingsPath, 'utf8')) as Partial<Settings>;
            settings = { ...settings, ...savedSettings };
        }
    } catch (error) {
        console.error('Error loading settings:', error);
    }
}

function saveSettings(): void {
    try {
        fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
    } catch (error) {
        console.error('Error saving settings:', error);
    }
}

function updateWindowBackground(): void {
    if (win) {
        const backgroundColor = nativeTheme.shouldUseDarkColors ? '#1e1e1e' : '#ffffff';
        win.setBackgroundColor(backgroundColor);
    }
}

function createMenu(): void {
    const template: Electron.MenuItemConstructorOptions[] = [
        {
            label: 'shader-studio',
            submenu: [
                {
                    label: 'Always on Top',
                    type: 'checkbox',
                    checked: settings.alwaysOnTop,
                    click: (menuItem: MenuItem) => {
                        settings.alwaysOnTop = menuItem.checked;
                        win.setAlwaysOnTop(settings.alwaysOnTop);
                        saveSettings();
                    }
                },
                { type: 'separator' },
                {
                    label: 'Theme',
                    submenu: [
                        {
                            label: 'Auto',
                            type: 'radio',
                            checked: settings.theme === 'system',
                            click: () => {
                                settings.theme = 'system';
                                nativeTheme.themeSource = 'system';
                                updateWindowBackground();
                                saveSettings();
                            }
                        },
                        {
                            label: 'Light',
                            type: 'radio',
                            checked: settings.theme === 'light',
                            click: () => {
                                settings.theme = 'light';
                                nativeTheme.themeSource = 'light';
                                updateWindowBackground();
                                saveSettings();
                            }
                        },
                        {
                            label: 'Dark',
                            type: 'radio',
                            checked: settings.theme === 'dark',
                            click: () => {
                                settings.theme = 'dark';
                                nativeTheme.themeSource = 'dark';
                                updateWindowBackground();
                                saveSettings();
                            }
                        }
                    ]
                },
                { type: 'separator' },
                {
                    label: 'Reload',
                    accelerator: 'CmdOrCtrl+R',
                    click: () => {
                        win.webContents.reload();
                    }
                },
                {
                    label: 'Toggle Developer Tools',
                    accelerator: 'F12',
                    click: () => {
                        win.webContents.toggleDevTools();
                    }
                },
                { type: 'separator' },
                { role: 'quit' }
            ]
        }
    ];
    const menu = Menu.buildFromTemplate(template);
    Menu.setApplicationMenu(menu);
}

app.whenReady().then(() => {
    loadSettings();

    nativeTheme.themeSource = settings.theme;

    let iconPath: string;
    iconPath = path.join(__dirname, '..', 'assets', 'icon.png');

    console.log('Icon path:', iconPath);
    console.log('Icon file exists:', fs.existsSync(iconPath));

    const icon = nativeImage.createFromPath(iconPath);
    console.log('Icon isEmpty:', icon.isEmpty());
    console.log('Icon size:', icon.getSize());

    if (process.platform === 'darwin' && !icon.isEmpty()) {
        app.dock?.setIcon(icon);
    }

    win = new BrowserWindow({
        width: settings.windowBounds.width,
        height: settings.windowBounds.height,
        x: settings.windowBounds.x,
        y: settings.windowBounds.y,
        alwaysOnTop: settings.alwaysOnTop,
        frame: true,
        title: 'Shader Studio',
        icon: icon.isEmpty() ? undefined : icon,
        backgroundColor: nativeTheme.shouldUseDarkColors ? '#1e1e1e' : '#ffffff',
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });

    win.on('resize', () => {
        settings.windowBounds = win.getBounds();
        saveSettings();
    });

    win.on('move', () => {
        settings.windowBounds = win.getBounds();
        saveSettings();
    });

    const uiPath: string = path.join(__dirname, '..', 'ui', 'index.html');

    if (process.env.NODE_ENV === 'development') {
        win.webContents.openDevTools();
    }

    win.loadFile(uiPath);

    createMenu();

    // Listen for system theme changes
    nativeTheme.on('updated', () => {
        updateWindowBackground();
    });
});

app.on('window-all-closed', () => app.quit());
