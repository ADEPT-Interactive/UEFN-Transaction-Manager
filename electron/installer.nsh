; electron-builder's keep-shortcuts upgrade path renames a legacy shortcut but
; does not rewrite its target. 4.0.1 used a different product/executable name
; while intentionally retaining the same appId, so repair both links after the
; standard installer macros have finished.
!macro customInstall
  !ifndef DO_NOT_CREATE_START_MENU_SHORTCUT
    !insertmacro createMenuDirectory
    ${if} $oldStartMenuLink != $newStartMenuLink
      WinShell::UninstShortcut "$oldStartMenuLink"
      Delete "$oldStartMenuLink"
    ${endIf}
    Delete "$newStartMenuLink"
    CreateShortCut "$newStartMenuLink" "$appExe" "" "$appExe" 0 "" "" "${APP_DESCRIPTION}"
    ClearErrors
    WinShell::SetLnkAUMI "$newStartMenuLink" "${APP_ID}"
  !endif

  !ifndef DO_NOT_CREATE_DESKTOP_SHORTCUT
    ${ifNot} ${isNoDesktopShortcut}
      ${if} $oldDesktopLink != $newDesktopLink
        WinShell::UninstShortcut "$oldDesktopLink"
        Delete "$oldDesktopLink"
      ${endIf}
      Delete "$newDesktopLink"
      CreateShortCut "$newDesktopLink" "$appExe" "" "$appExe" 0 "" "" "${APP_DESCRIPTION}"
      ClearErrors
      WinShell::SetLnkAUMI "$newDesktopLink" "${APP_ID}"
    ${endIf}
  !endif

  System::Call 'Shell32::SHChangeNotify(i 0x8000000, i 0, i 0, i 0)'
!macroend
