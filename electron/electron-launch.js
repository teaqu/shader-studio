const { app, BrowserWindow, Menu, ipcMain, nativeImage } = require('electron');
const path = require('path');

let win;
let alwaysOnTop = process.argv.includes('--alwaysOnTop');

app.setName('Shader View');

function createMenu() {
  const template = [
    {
      label: 'Shader View',
      submenu: [
        {
          label: 'Always on Top',
          type: 'checkbox',
          checked: alwaysOnTop,
          click: (menuItem) => {
            alwaysOnTop = menuItem.checked;
            win.setAlwaysOnTop(alwaysOnTop);
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
    width: 800,
    height: 600,
    alwaysOnTop,
    frame: true,
    title: 'Shader View',
    icon: icon.isEmpty() ? undefined : icon,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
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
