@echo off
echo ============================================
echo  CRM Tool - Starting Services
echo ============================================
echo.

REM Check Docker
docker info >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Docker is not running. Start Docker Desktop first.
    pause
    exit /b 1
)

REM Start Postgres
docker ps --format "%%.Names" | findstr "crm-postgres" >nul 2>&1
if %errorlevel% neq 0 (
    echo Starting PostgreSQL...
    docker run -d --name crm-postgres -e POSTGRES_DB=crm_db -e POSTGRES_USER=admin -e POSTGRES_PASSWORD=changeme -p 127.0.0.1:5432:5432 pgvector/pgvector:pg16 >nul
) else (
    echo PostgreSQL already running.
)

REM Start Redis
docker ps --format "%%.Names" | findstr "crm-redis" >nul 2>&1
if %errorlevel% neq 0 (
    echo Starting Redis...
    docker run -d --name crm-redis -p 127.0.0.1:6379:6379 redis:7-alpine redis-server --appendonly yes --requirepass changeme >nul
) else (
    echo Redis already running.
)

echo Waiting for database...
timeout /t 5 /nobreak >nul

REM Start web app
echo Starting CRM Web App...
echo.
echo ============================================
echo  CRM Tool is running!
echo.
echo  Open: http://localhost:3000
echo  Register a new account to get started.
echo ============================================
echo.

cd /d "%~dp0apps\web"
npx next dev --port 3000
