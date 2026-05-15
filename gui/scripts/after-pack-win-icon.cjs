/**
 * Embeds the Windows .exe icon without electron-builder's rcedit path, which downloads
 * winCodeSign-2.6.0.7z and fails to extract on Windows without symlink privileges (Developer Mode / admin).
 * Runs in afterPack: after ASAR integrity is written to the exe, before signing (skipped when unsigned).
 */
const fs = require('fs');
const path = require('path');

module.exports = async (context) => {
  if (context.electronPlatformName !== 'win32') {
    return;
  }
  const iconPath = path.join(context.packager.projectDir, 'public', 'favicon.ico');
  if (!fs.existsSync(iconPath)) {
    return;
  }
  const exePath = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.exe`
  );
  if (!fs.existsSync(exePath)) {
    return;
  }
  const rcedit = require('rcedit');
  await rcedit(exePath, { icon: iconPath });
};
