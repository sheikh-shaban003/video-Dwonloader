@echo off
setlocal EnableExtensions
cd /d "%~dp0"
where docker >nul 2>nul
if errorlevel 1 (
  echo Docker Desktop is required.
  echo Install it from https://www.docker.com/products/docker-desktop/ and start it, then run this file again.
  pause
  exit /b 1
)
docker info >nul 2>nul
if errorlevel 1 (
  echo Docker is installed but is not running yet. Open Docker Desktop and wait until it says Running.
  pause
  exit /b 1
)
if not exist .env (
  copy .env.example .env >nul
  echo Created .env from .env.example.
  echo Edit .env and add OPENAI_API_KEY to enable AI image generation. Video downloader works without this key.
)
echo.
echo Building the complete website + video downloader + AI API container.
echo The first build needs internet and can take several minutes.
docker compose up --build -d
if errorlevel 1 goto failed
echo.
echo Waiting for the API to become healthy...
for /l %%i in (1,1,45) do (
  curl -fsS http://localhost:8088/api/health >nul 2>nul && goto ready
  timeout /t 2 /nobreak >nul
)
echo API did not respond within 90 seconds. Recent logs:
docker compose ps
docker compose logs --tail=100 website
echo.
echo Try: docker compose logs -f website
pause
exit /b 1
:ready
echo.
echo Website and backend are responding.
echo Website:              http://localhost:8088
echo Downloader health:    http://localhost:8088/api/health
echo AI image API health:  http://localhost:8088/api/images/health
echo Logs:                 docker compose logs -f website
echo Stop:                 docker compose down
start "" "http://localhost:8088"
endlocal
exit /b 0
:failed
echo Docker build/start failed. Recent logs:
docker compose logs --tail=150 website
pause
exit /b 1
