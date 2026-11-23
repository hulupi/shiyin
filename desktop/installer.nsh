; Avoid shell encoding/quoting and directory-prefix process matching.
!macro customCheckAppRunning
  shiyin_check:
  ${nsProcess::FindProcess} "${APP_EXECUTABLE_FILENAME}" $R0
  ${If} $R0 == 0
    MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION "$(appRunning)" /SD IDCANCEL IDOK shiyin_close
    Quit
    shiyin_close:
    ${nsProcess::CloseProcess} "${APP_EXECUTABLE_FILENAME}" $R0
    Sleep 1000
    ${nsProcess::FindProcess} "${APP_EXECUTABLE_FILENAME}" $R0
    ${If} $R0 == 0
      ${nsProcess::KillProcess} "${APP_EXECUTABLE_FILENAME}" $R0
      Sleep 1000
      ${nsProcess::FindProcess} "${APP_EXECUTABLE_FILENAME}" $R0
    ${EndIf}
  ${EndIf}
  ${If} $R0 != 603
    MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "无法确认拾音进程已退出（检测码 $R0）。请关闭拾音后重试。" /SD IDCANCEL IDRETRY shiyin_check
    Quit
  ${EndIf}
!macroend


; Avoid recursive file moves during upgrade; retain standard user-data handling.
!macro customRemoveFiles
  ${IfNot} ${FileExists} "$INSTDIR\resources\app.asar"
    Abort "安装目录校验失败，未删除任何文件。"
  ${EndIf}
  SetOutPath $TEMP
  ClearErrors
  RMDir /r "$INSTDIR"
  ${If} ${Errors}
    Abort "无法移除旧程序文件，请关闭占用安装目录的软件后重试。"
  ${EndIf}
!macroend
