@echo off
rem 启动 DSH Web（在独立最小化窗口中运行，日志写入用户目录）
cd /d "C:\Users\admin\deepseek-harness"
pnpm dsh web >> "%USERPROFILE%\dsh-web.log" 2>&1
