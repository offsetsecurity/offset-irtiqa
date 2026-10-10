' What the shortcuts run.
'
' Node always takes a console window, and there is no windowless node.exe the
' way there is a pythonw.exe. So a shortcut that runs node directly puts a
' black window on the screen, and on Windows 11 that window is a Terminal tab
' the person is entitled to close - which killed the product, because the
' console it lived in went with it.
'
' Four lines of script solve what no Inno flag can: run it with window style 0,
' hidden, and do not wait for it.

Dim shell, here, node, opener
Set shell = CreateObject("WScript.Shell")

' This file sits in <install>\app\, and node.exe one level above it.
here = Left(WScript.ScriptFullName, InStrRev(WScript.ScriptFullName, "\"))
node = here & "..\node.exe"
opener = here & "open.js"

shell.Run """" & node & """ """ & opener & """", 0, False
