# BytesProtector custom NSIS installer hooks
# This file is included by electron-builder automatically

!macro customInstall
  # Create start menu folder
  CreateDirectory "$SMPROGRAMS\BytesProtector"
  
  # Register as antivirus in Windows Security Center (optional, requires elevation)
  # WriteRegStr HKLM "SOFTWARE\Microsoft\Security Center\Monitoring\BytesProtector" "" "1"
  
  # Add to Windows Defender exclusions for our own quarantine folder
  nsExec::ExecToStack 'powershell -Command "Add-MpPreference -ExclusionPath \"$APPDATA\BytesProtector\quarantine\""'
  
  # Create quarantine and logs dirs in AppData
  CreateDirectory "$APPDATA\BytesProtector\quarantine"
  CreateDirectory "$APPDATA\BytesProtector\logs"
  
  # Copy default config if not already present
  ${IfNot} ${FileExists} "$APPDATA\BytesProtector\settings.json"
    CopyFiles "$INSTDIR\resources\app.asar.unpacked\config\settings.json" "$APPDATA\BytesProtector\settings.json"
  ${EndIf}
!macroend

!macro customUnInstall
  # Clean up AppData on uninstall (ask user)
  MessageBox MB_YESNO "Remove all scan history and quarantine files?" IDNO skip_cleanup
    RMDir /r "$APPDATA\BytesProtector"
  skip_cleanup:
  
  # Remove start menu
  RMDir /r "$SMPROGRAMS\BytesProtector"
!macroend
