@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo 正在启动本地网站 http://localhost:8000 ...
start "" cmd /c "timeout /t 1 >nul & start http://localhost:8000"
python -m http.server 8000
