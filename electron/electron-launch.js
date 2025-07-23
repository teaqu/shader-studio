const { app, BrowserWindow, Menu, ipcMain, nativeImage, nativeTheme } = require('electron');
const path = require('path');
const fs = require('fs');

let win;
let settings = {
  alwaysOnTop: process.argv.includes('--alwaysOnTop'),
  theme: 'system',
  windowBounds: {
    width: 800,
    height: 600,
    x: undefined,
    y: undefined
  }
};

const settingsPath = path.join(app.getPath('userData'), 'settings.json');

app.setName('Shader View');

function loadSettings() {
  try {
    if (fs.existsSync(settingsPath)) {
      const savedSettings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      settings = { ...settings, ...savedSettings };
    }
  } catch (error) {
    console.error('Error loading settings:', error);
  }
}

function saveSettings() {
  try {
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
  } catch (error) {
    console.error('Error saving settings:', error);
  }
}

function createMenu() {
  const template = [
    {
      label: 'Shader View',
      submenu: [
        {
          label: 'Always on Top',
          type: 'checkbox',
          checked: settings.alwaysOnTop,
          click: (menuItem) => {
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
  
  // Apply saved theme
  nativeTheme.themeSource = settings.theme;
  
  // Use .icns for macOS, .png for others
  let iconPath;
  if (process.platform === 'darwin') {
    iconPath = path.join(__dirname, 'icon.icns');
  } else {
    iconPath = path.join(__dirname, 'icon.png');
  }
  const icon = nativeImage.createFromPath(iconPath);

  // Set dock icon for macOS
  if (process.platform === 'darwin' && icon.isEmpty() === false) {
    app.dock.setIcon(icon);
  }

  win = new BrowserWindow({
    width: settings.windowBounds.width,
    height: settings.windowBounds.height,
    x: settings.windowBounds.x,
    y: settings.windowBounds.y,
    alwaysOnTop: settings.alwaysOnTop,
    frame: true,
    title: 'Shader View',
    icon: icon.isEmpty() ? undefined : icon,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  // Save window bounds when they change
  win.on('resize', () => {
    settings.windowBounds = win.getBounds();
    saveSettings();
  });

  win.on('move', () => {
    settings.windowBounds = win.getBounds();
    saveSettings();
  });

  // Load the UI files locally instead of from localhost:3000
  const uiPath = path.join(__dirname, 'ui', 'index.html');
  
  // For development, we can also enable dev tools
  if (process.env.NODE_ENV === 'development') {
    win.webContents.openDevTools();
  }
  
  win.loadFile(uiPath);
  
  createMenu();
});

app.on('window-all-closed', () => app.quit());
