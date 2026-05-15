'use strict';

const fs = require('fs');
const path = require('path');

const target = path.join(__dirname, '..', 'electron-dist');

if (!fs.existsSync(target)) {
  process.exit(0);
}

try {
  fs.rmSync(target, { recursive: true, force: true });
  console.log('Removed electron-dist/');
} catch (err) {
  console.error(
    [
      'Could not remove gui/electron-dist (files are in use).',
      '- Quit "DDS Robot GUI" if it is running.',
      '- In Task Manager, end any stray "DDS Robot GUI" or "electron.exe" processes.',
      '- Close File Explorer windows showing that folder.',
      '- Retry, or reboot if something still holds a lock.',
      '',
      `System message: ${err.message}`,
    ].join('\n')
  );
  process.exit(1);
}
