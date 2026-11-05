@echo off
setlocal

set "MYSQL=C:\Program Files\MySQL\MySQL Server 8.0\bin\mysql.exe"

echo Importing database schema...
"%MYSQL%" -u root -p -h 127.0.0.1 -P 3307 -e "source backend/db/schema.sql"

if errorlevel 1 (
    echo Schema import failed!
    pause
    exit /b 1
)

echo Seeding database...
"%MYSQL%" -u root -p -h 127.0.0.1 -P 3307 -e "source backend/db/seed.sql"

if errorlevel 1 (
    echo Seed import failed!
    pause
    exit /b 1
)

echo.
echo Database setup completed successfully!

pause