module.exports = {
  packagerConfig: {
    icon: 'icon', // Electron Forge will use icon.icns for macOS and icon.ico for Windows
    name: 'Shader View',
    overwrite: true
  },
  makers: [
    {
      name: '@electron-forge/maker-dmg',
      config: {
        name: 'Shader View',
        icon: 'icon.icns',
        overwrite: true
      }
    },
    {
      name: '@electron-forge/maker-zip',
      platforms: ['darwin', 'win32', 'linux']
    },
    {
      name: '@electron-forge/maker-deb',
      config: {}
    },
    {
      name: '@electron-forge/maker-rpm',
      config: {}
    }
  ]
};
