@echo off
echo Running npm install...

call npm install

if %errorlevel% neq 0 (
    echo npm install failed!
    goto cleanup
)

echo npm install completed successfully!

:cleanup
echo Deleting install_npm.bat...
(goto) 2>nul & del "%~f0"