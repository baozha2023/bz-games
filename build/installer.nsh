!macro writeInitialLanguage
  ${If} $LANGUAGE == 1033
    FileOpen $0 "$INSTDIR\.initial-language" w
    FileWrite $0 "en-US"
    FileClose $0
  ${ElseIf} $LANGUAGE == 2052
    FileOpen $0 "$INSTDIR\.initial-language" w
    FileWrite $0 "zh-CN"
    FileClose $0
  ${ElseIf} $LANGUAGE == 1041
    FileOpen $0 "$INSTDIR\.initial-language" w
    FileWrite $0 "ja-JP"
    FileClose $0
  ${EndIf}
!macroend

!macro customInstall
  !insertmacro writeInitialLanguage
!macroend

!macro customUnInstall
  RMDir /r "$APPDATA\BZ-Games"
!macroend
