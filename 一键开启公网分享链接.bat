@echo off
chcp 65001 >nul
title 河北元赫汽车服务 - 公网分享与服务启动器
echo ======================================================================
echo   正在启动【河北元赫汽车服务】本地服务器与公网穿透隧道...
echo   请在下方输出的方框中复制 https://xxxx.trycloudflare.com 链接发给他人！
echo ======================================================================
start /b python "%~dp0yuanhe_server.py"
"D:\Antigravity\项目文件\我的软件\cloudflared.exe" tunnel --url http://127.0.0.1:8688
pause
