; Re-create Start Menu / Desktop shortcuts with an explicit .ico path. The default
; template uses the .exe as the icon source ("$appExe", 0), which can still show
; Electron's stock icon in Explorer for some PE layouts; a standalone .ico is reliable.

!macro customInstall
  IfFileExists "$INSTDIR\resources\shortcut-icon.ico" 0 customInstallShortcutIconDone
  IfFileExists "$newDesktopLink" 0 +3
    CreateShortCut "$newDesktopLink" "$appExe" "" "$INSTDIR\resources\shortcut-icon.ico" 0 "" "" "${APP_DESCRIPTION}"
    WinShell::SetLnkAUMI "$newDesktopLink" "${APP_ID}"
  IfFileExists "$newStartMenuLink" 0 +3
    CreateShortCut "$newStartMenuLink" "$appExe" "" "$INSTDIR\resources\shortcut-icon.ico" 0 "" "" "${APP_DESCRIPTION}"
    WinShell::SetLnkAUMI "$newStartMenuLink" "${APP_ID}"
  System::Call 'Shell32::SHChangeNotify(i 0x8000000, i 0, i 0, i 0)'
  customInstallShortcutIconDone:
!macroend
