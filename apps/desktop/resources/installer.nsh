; Custom NSIS hooks for OpenDeskmate installer UX.
!include "nsDialogs.nsh"
!include "MUI2.nsh"
!include "WinMessages.nsh"
!include "LogicLib.nsh"

!define KEYCHAIN_SERVICE "ai.accomplish.desktop"

!undef APP_FILENAME
!define APP_FILENAME "opendeskmate"

!macro customWelcomePage
  !insertmacro MUI_PAGE_WELCOME
!macroend

!macro customInstallMode
  StrCpy $isForceCurrentInstall "1"
!macroend

!ifdef BUILD_UNINSTALLER
  Var UninstDeleteAppData
  Var UninstDeleteAppDataPage
  Var UninstKeepDataRadio
  Var UninstRemoveDataRadio

  !macro customUnInit
    StrCpy $UninstDeleteAppData "0"
    ClearErrors
    ${GetParameters} $R0
    ${GetOptions} $R0 "--delete-app-data" $R1
    IfErrors +2 0
    StrCpy $UninstDeleteAppData "1"
  !macroend

  !macro customUnWelcomePage
    !insertmacro MUI_UNPAGE_WELCOME
    UninstPage custom un.DeleteAppDataPageCreate un.DeleteAppDataPageLeave
  !macroend

  Function un.DeleteAppDataPageCreate
    IfSilent 0 +2
    Abort

    StrCmp $UninstDeleteAppData "1" 0 +2
    Abort

    nsDialogs::Create 1018
    Pop $UninstDeleteAppDataPage

    !insertmacro MUI_HEADER_TEXT "Uninstall Options" "Choose whether to remove app data"
    ${NSD_CreateLabel} 0u 0u 300u 30u "OpenDeskmate can remove settings, cache, and stored API keys."
    Pop $0

    ${NSD_CreateRadioButton} 0u 34u 300u 12u "&Keep app data"
    Pop $UninstKeepDataRadio
    ${NSD_CreateRadioButton} 0u 52u 300u 12u "&Remove app data"
    Pop $UninstRemoveDataRadio

    StrCmp $UninstDeleteAppData "1" 0 +3
    SendMessage $UninstRemoveDataRadio ${BM_SETCHECK} ${BST_CHECKED} 0
    Goto +2
    SendMessage $UninstKeepDataRadio ${BM_SETCHECK} ${BST_CHECKED} 0

    nsDialogs::Show
  FunctionEnd

  Function un.DeleteAppDataPageLeave
    ${NSD_GetState} $UninstRemoveDataRadio $0
    StrCmp $0 ${BST_CHECKED} 0 +2
    StrCpy $UninstDeleteAppData "1"
    Goto +2
    StrCpy $UninstDeleteAppData "0"
  FunctionEnd

  !macro customUnInstall
    ${If} $UninstDeleteAppData == "1"
      DetailPrint "Removing app data"
      ${If} $installMode == "all"
        SetShellVarContext current
      ${EndIf}

      RMDir /r "$APPDATA\${APP_FILENAME}"
      !ifdef APP_PRODUCT_FILENAME
        RMDir /r "$APPDATA\${APP_PRODUCT_FILENAME}"
      !endif
      !ifdef APP_PACKAGE_NAME
        RMDir /r "$APPDATA\${APP_PACKAGE_NAME}"
      !endif

      RMDir /r "$LOCALAPPDATA\${APP_FILENAME}"
      !ifdef APP_PRODUCT_FILENAME
        RMDir /r "$LOCALAPPDATA\${APP_PRODUCT_FILENAME}"
      !endif
      !ifdef APP_PACKAGE_NAME
        RMDir /r "$LOCALAPPDATA\${APP_PACKAGE_NAME}"
      !endif

      ; Remove stored API keys from Windows Credential Manager (keytar).
      nsExec::ExecToLog 'cmd.exe /C cmdkey /delete:"${KEYCHAIN_SERVICE}/apiKey:anthropic"'
      nsExec::ExecToLog 'cmd.exe /C cmdkey /delete:"${KEYCHAIN_SERVICE}/apiKey:openai"'
      nsExec::ExecToLog 'cmd.exe /C cmdkey /delete:"${KEYCHAIN_SERVICE}/apiKey:google"'
      nsExec::ExecToLog 'cmd.exe /C cmdkey /delete:"${KEYCHAIN_SERVICE}/apiKey:xai"'
      nsExec::ExecToLog 'cmd.exe /C cmdkey /delete:"${KEYCHAIN_SERVICE}/apiKey:custom"'

      ${If} $installMode == "all"
        SetShellVarContext all
      ${EndIf}
    ${EndIf}
  !macroend
!endif
