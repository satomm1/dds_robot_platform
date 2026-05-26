const {
  windowsPathToWsl,
  escapeBashSingleQuoted,
  normalizeDdsSettings,
  resolvePathForShell,
  resolveDdsDirForShell,
  shellPlatformRoot,
  shellDdsDirFromPlatform,
  migrateLegacyDdsPathToPlatform,
} = require('../../electron/ddsLocalPaths');

describe('windowsPathToWsl', () => {
  it('converts drive letter paths', () => {
    expect(windowsPathToWsl('C:\\Users\\foo\\dds_robot_platform')).toBe(
      '/mnt/c/Users/foo/dds_robot_platform',
    );
  });

  it('handles forward slashes', () => {
    expect(windowsPathToWsl('D:/projects/dds_robot_platform')).toBe(
      '/mnt/d/projects/dds_robot_platform',
    );
  });

  it('returns empty for empty input', () => {
    expect(windowsPathToWsl('')).toBe('');
    expect(windowsPathToWsl(null)).toBe('');
  });
});

describe('escapeBashSingleQuoted', () => {
  it('escapes single quotes', () => {
    expect(escapeBashSingleQuoted("it's fine")).toBe("it'\\''s fine");
  });

  it('handles null', () => {
    expect(escapeBashSingleQuoted(null)).toBe('');
  });
});

describe('normalizeDdsSettings', () => {
  it('trims strings and migrates legacy dds path', () => {
    expect(
      normalizeDdsSettings({ ddsDir: '  /foo/dds  ', wslDistro: ' Ubuntu ' }),
    ).toEqual({ platformDir: '/foo', wslDistro: 'Ubuntu' });
  });

  it('keeps platform root paths', () => {
    expect(
      normalizeDdsSettings({
        platformDir: '  /home/user/dds_robot_platform  ',
        wslDistro: '',
      }),
    ).toEqual({ platformDir: '/home/user/dds_robot_platform', wslDistro: '' });
  });
});

describe('migrateLegacyDdsPathToPlatform', () => {
  it('strips trailing /dds', () => {
    expect(migrateLegacyDdsPathToPlatform('/foo/dds')).toBe('/foo');
  });
});

describe('resolvePathForShell', () => {
  it('keeps WSL home paths on Windows', () => {
    expect(
      resolvePathForShell('/home/satomm/dds_robot_platform', true),
    ).toBe('/home/satomm/dds_robot_platform');
  });

  it('converts wsl.localhost UNC paths', () => {
    expect(
      resolvePathForShell(
        '\\\\wsl.localhost\\Ubuntu\\home\\satomm\\dds_robot_platform',
        true,
      ),
    ).toBe('/home/satomm/dds_robot_platform');
  });
});

describe('resolveDdsDirForShell', () => {
  it('aliases resolvePathForShell', () => {
    expect(resolveDdsDirForShell('/foo', false)).toBe('/foo');
  });
});

describe('shellDdsDirFromPlatform', () => {
  it('appends dds under platform root', () => {
    expect(
      shellDdsDirFromPlatform('/home/satomm/dds_robot_platform', true),
    ).toBe('/home/satomm/dds_robot_platform/dds');
  });

  it('returns empty for invalid input', () => {
    expect(shellDdsDirFromPlatform('', true)).toBe('');
  });
});

describe('shellPlatformRoot', () => {
  it('resolves platform root on WSL paths', () => {
    expect(shellPlatformRoot('/home/satomm/dds_robot_platform', true)).toBe(
      '/home/satomm/dds_robot_platform',
    );
  });
});
