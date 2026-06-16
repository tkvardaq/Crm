@echo off
echo Starting CRM Tool with Docker...

REM Check if Docker is running
docker info >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Docker is not running. Please start Docker Desktop first.
    pause
    exit /b 1
)

echo Pulling base images...
docker compose -f docker-compose.dev.yml pull postgres redis

echo Starting services...
docker compose -f docker-compose.dev.yml up -d postgres redis

echo Waiting for database to be ready...
:wait_db
docker exec crm-postgres pg_isready -U admin -d crm_db >nul 2>&1
if %errorlevel% neq 0 (
    echo Waiting for PostgreSQL...
    timeout /t 3 >nul
    goto wait_db
)

echo Database ready. Building web app...
docker compose -f docker-compose.dev.yml build web

echo Starting web app and LeadStealth...
docker compose -f docker-compose.dev.yml up -d web leadstealth

echo.
echo ============================================
echo CRM Tool is starting!
echo.
echo Web app:     http://localhost:3000
echo LeadStealth: http://localhost:8001
echo.
echo Login with: admin@acme.com / password (from registration)
echo ============================================
echo.
echo To view logs: docker compose -f docker-compose.dev.yml logs -f web
echo To stop:      docker compose -f docker-compose.dev.yml down
echo.

pause