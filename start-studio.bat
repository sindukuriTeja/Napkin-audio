@echo off
REM Napkin Audio AI Studio - one-click local start
REM Starts the backend proxy (Claude / ElevenLabs) and the frontend dev server
REM in their own windows, so you don't have to run two terminals by hand.

cd /d "%~dp0"

if not exist "node_modules" (
    echo node_modules not found - running npm install first...
    call npm install
    if errorlevel 1 (
        echo.
        echo npm install failed. Fix the error above and re-run start-studio.bat.
        echo.
        pause
        exit /b 1
    )
)

findstr /b /c:"ANTHROPIC_API_KEY=" .env | findstr /r /c:"ANTHROPIC_API_KEY=.\{5,\}" >nul 2>&1
if errorlevel 1 (
    echo.
    echo WARNING: ANTHROPIC_API_KEY is not set in .env.
    echo Add ANTHROPIC_API_KEY=your-key to .env so "Generate full production plan" works.
    echo Continuing anyway - the backend window below will show the real error if this is the problem.
    echo.
    timeout /t 3 >nul
)

echo Starting backend proxy (Claude + ElevenLabs) ...
start "Napkin Audio - Backend (npm run server)" cmd /k npm run server

timeout /t 2 >nul

echo Starting frontend dev server ...
start "Napkin Audio - Frontend (npm run dev)" cmd /k npm run dev

echo.
echo Two windows just opened: one for the backend, one for the frontend.
echo Wait a few seconds, then open the URL shown in the "Frontend" window (usually http://localhost:5173).
echo.
echo Tip: the Studio tab's "Generate full production plan" feature needs ANTHROPIC_API_KEY
echo set in .env (ANTHROPIC_MODEL, default claude-sonnet-5). Everything else works
echo without it, using mock or ElevenLabs voices.
echo.
pause
