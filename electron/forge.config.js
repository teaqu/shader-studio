module.exports = {
  packagerConfig: {
    icon: 'assets/icon',
    name: 'Shadera',
    overwrite: true
  },
  makers: [
    {
      name: '@electron-forge/maker-dmg',
      config: {
        name: 'Shadera',
        icon: 'assets/icon.icns',
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
