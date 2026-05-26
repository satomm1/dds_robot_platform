const {
  windowsPathToWsl,
  escapeBashSingleQuoted,
  normalizeDdsSettings,
  resolveDdsDirForShell,
} = require('./ddsLocalPaths');

describe('windowsPathToWsl', () => {
  it('converts drive letter paths', () => {
    expect(windowsPathToWsl('C:\\Users\\foo\\dds')).toBe('/mnt/c/Users/foo/dds');
  });

  it('handles forward slashes', () => {
    expect(windowsPathToWsl('D:/projects/dds_robot_platform/dds')).toBe(
      '/mnt/d/projects/dds_robot_platform/dds',
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
  it('trims strings', () => {
    expect(
      normalizeDdsSettings({ ddsDir: '  /foo/dds  ', wslDistro: ' Ubuntu ' }),
    ).toEqual({ ddsDir: '/foo/dds', wslDistro: 'Ubuntu' });
  });
});

describe('resolveDdsDirForShell', () => {
  it('keeps WSL home paths on Windows', () => {
    expect(
      resolveDdsDirForShell('/home/satomm/dds_robot_platform/dds', true),
    ).toBe('/home/satomm/dds_robot_platform/dds');
  });

  it('converts wsl.localhost UNC paths', () => {
    expect(
      resolveDdsDirForShell(
        '\\\\wsl.localhost\\Ubuntu\\home\\satomm\\dds_robot_platform\\dds',
        true,
      ),
    ).toBe('/home/satomm/dds_robot_platform/dds');
  });
});
