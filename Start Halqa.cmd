@echo off
rem Starts the Halqa app and its worker on this computer.
cd /d "%~dp0"
if not exist node_modules call npm ci
if errorlevel 1 goto failed
if not exist data\halqa.sqlite goto needsetup
echo.
echo Halqa is starting at http://localhost:3000
echo Keep this window open. Press Ctrl+C to stop.
echo.
call npm run dev
goto end
:needsetup
echo.
echo There is no database yet. Create the first clinic lead account once:
echo.
echo   npm run setup -- --email you@yourclinic.org --name "Your Name" --org "Your Organisation"
echo.
echo The temporary password is shown once in that window. Then run this script again.
pause
goto end
:failed
echo Halqa could not start. Check the message above.
pause
:end
