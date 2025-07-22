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
  const iconPath = path.join(__dirname, 'icon.png');
  const icon = nativeImage.createFromPath(iconPath);
  
  win = new BrowserWindow({
    width: 1200,
    height: 800,
    alwaysOnTop,
    frame: true,
    title: 'Shader View',
    icon: icon,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });
  
  win.loadURL(process.argv[2] || 'http://localhost:3000');
  createMenu();
});

app.on('window-all-closed', () => app.quit());
