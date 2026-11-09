Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
strDir = fso.GetParentFolderName(WScript.ScriptFullName)
WshShell.CurrentDirectory = strDir

strPy = "python"
If fso.FileExists("D:\python3.12.4\python.exe") Then
    strPy = """D:\python3.12.4\python.exe"""
End If

WshShell.Run "cmd /c " & strPy & " yuanhe_server.py", 0, False
WScript.Sleep 500

strUrl = "http://127.0.0.1:8090"
On Error Resume Next
WshShell.Run "msedge.exe --app=""" & strUrl & """ --window-size=1440,920", 1, False
If Err.Number <> 0 Then
    Err.Clear
    WshShell.Run strUrl, 1, False
End If
