@echo off
REM Napkin Audio AI Studio - one-click local start
REM Starts the backend proxy (Llama 3 / ElevenLabs) and the frontend dev server
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

echo Checking Ollama is reachable on 127.0.0.1:11434 ...
curl -s -m 3 http://127.0.0.1:11434/api/tags >nul 2>&1
if errorlevel 1 (
    echo.
    echo WARNING: Could not reach Ollama at http://127.0.0.1:11434
    echo Make sure the Ollama app is running and "llama3" is pulled ^(ollama list^).
    echo Continuing anyway - the backend window below will show the real error if this is the problem.
    echo.
    timeout /t 3 >nul
)

echo Starting backend proxy (Llama 3 + ElevenLabs) ...
start "Napkin Audio - Backend (npm run server)" cmd /k npm run server

timeout /t 2 >nul

echo Starting frontend dev server ...
start "Napkin Audio - Frontend (npm run dev)" cmd /k npm run dev

echo.
echo Two windows just opened: one for the backend, one for the frontend.
echo Wait a few seconds, then open the URL shown in the "Frontend" window (usually http://localhost:5173).
echo.
echo Tip: the Studio tab's "Generate full production plan" feature needs Ollama running
echo with the model set in .env (OLLAMA_MODEL, default llama3). Everything else works
echo without Ollama, using mock or ElevenLabs voices.
echo.
pause
