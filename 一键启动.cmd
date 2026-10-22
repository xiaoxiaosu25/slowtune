@echo off
chcp 65001 >nul
setlocal
where node >nul 2>nul
if errorlevel 1 (
  echo 未找到 Node。请安装 Node 24.15 或更新的兼容版本。
  pause
  exit /b 1
)
node "%~dp0scripts\desktop.mjs" --detach
if errorlevel 1 (
  echo 慢听桌面端启动失败，请查看上方错误。
  pause
  exit /b 1
)
exit /b 0
