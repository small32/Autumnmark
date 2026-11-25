; Windows can keep a UserChoice pointing to this ProgId across upgrades.
!define AUTUMNMARK_PROGID "AutumnMark.Document"

; OpenWithProgids lets Explorer offer AutumnMark+ while preserving the user's default app.
!macro autumnmarkAssociateExtension EXT
  WriteRegNone SHELL_CONTEXT "Software\Classes\${EXT}\OpenWithProgids" "${AUTUMNMARK_PROGID}"
!macroend

!macro autumnmarkUnassociateExtension EXT
  DeleteRegValue SHELL_CONTEXT "Software\Classes\${EXT}\OpenWithProgids" "${AUTUMNMARK_PROGID}"
!macroend

!macro customInstall
  Push $0
  FileOpen $0 "$INSTDIR\resources\nsis-installed" w
  FileWrite $0 "NSIS"
  FileClose $0
  Pop $0

  !insertmacro autumnmarkAssociateExtension ".md"
  !insertmacro autumnmarkAssociateExtension ".markdown"
  !insertmacro autumnmarkAssociateExtension ".mmd"
  !insertmacro autumnmarkAssociateExtension ".mdown"
  !insertmacro autumnmarkAssociateExtension ".mdtxt"
  !insertmacro autumnmarkAssociateExtension ".mdtext"
  !insertmacro autumnmarkAssociateExtension ".mdx"

  WriteRegStr SHELL_CONTEXT "Software\Classes\${AUTUMNMARK_PROGID}" \
    "" "AutumnMark+ Markdown Document"
  WriteRegExpandStr SHELL_CONTEXT "Software\Classes\${AUTUMNMARK_PROGID}\DefaultIcon" \
    "" "$INSTDIR\resources\icons\md.ico,0"
  WriteRegExpandStr SHELL_CONTEXT "Software\Classes\${AUTUMNMARK_PROGID}\shell\open\command" \
    "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"'

  ; Explorer serves file types from a cache that a fresh install otherwise
  ; keeps until the next sign-in.
  System::Call 'shell32::SHChangeNotify(i, i, i, i) v (0x08000000, 0, 0, 0)'
!macroend

!macro customUnInstall
  ; Keep the association and profile intact when an update invokes this uninstaller.
  ${ifNot} ${isUpdated}
    !insertmacro autumnmarkUnassociateExtension ".md"
    !insertmacro autumnmarkUnassociateExtension ".markdown"
    !insertmacro autumnmarkUnassociateExtension ".mmd"
    !insertmacro autumnmarkUnassociateExtension ".mdown"
    !insertmacro autumnmarkUnassociateExtension ".mdtxt"
    !insertmacro autumnmarkUnassociateExtension ".mdtext"
    !insertmacro autumnmarkUnassociateExtension ".mdx"
    DeleteRegKey SHELL_CONTEXT "Software\Classes\${AUTUMNMARK_PROGID}"

    MessageBox MB_YESNO "Do you want to delete user settings?" /SD IDNO IDNO SkipRemoval
      SetShellVarContext current
      RMDir /r "$APPDATA\${APP_PACKAGE_NAME}"
    SkipRemoval:
  ${endIf}
!macroend
