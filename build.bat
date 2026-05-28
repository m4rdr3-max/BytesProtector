@echo off
echo( ____ ___  _ _____ _____ ____  ____  ____  ____ _____ _____ ____ _____ ____  ____ 
echo(/  __\\  \///__ __Y  __// ___\/  __\/  __\/  _ Y__ __Y  __//   _Y__ __Y  _ \/  __\
echo(^| ^| // \  /   / \ ^|  \  ^|    \^|  \/^|^|  \/^|^| / \^| / \ ^|  \  ^|  /   / \ ^| / \^|^|  \/^|
echo(^| ^|_\\ / /    ^| ^| ^|  /_ \___ ^|^|  __/^|    /^| \_/^| ^| ^| ^|  /_ ^|  \_  ^| ^| ^| \_/^|^|    /
echo(\____//_/     \_/ \____\\____/\_/   \_/\_\\____/ \_/ \____\\____/ \_/ \____/\_/\_\
echo(                                                                                  
echo(               ____  _     _  _     ____    ____  ____ _____ ____ _               
echo(              /  __\/ \ /\/ \/ \   /  _ \  /  __\/  _ Y__ __Y   _Y \ /^|          
echo(              ^| ^| //^| ^| ^|^|^| ^|^| ^|   ^| ^| \^|  ^| ^| //^| ^| \^| / \ ^|  / ^| ^|_^|^|          
echo(              ^| ^|_\\^| \_/^|^| ^|^| ^|_/\^| ^|_/^|  ^| ^|_\\^| ^|-^|^| ^| ^| ^|  \_^| ^| ^|^|          
echo(              \____/\____/\_/\____/\____/  \____/\_/ \^| \_/ \____^|_/ \^|          
echo(
echo  BytesProtector  ^|  Developer Build Script
echo  ===============================================
echo.

REM ── Check python-embed is populated ───────────────────────────────────────
if not exist "python-embed\python.exe" (
    echo [WARN] python-embed\python.exe not found^^!
    echo.
    echo  The bundled Python runtime is missing. Users will need Python installed.
    echo  To bundle Python ^(recommended for releases^):
    echo.
    echo  1. Download: https://www.python.org/ftp/python/3.11.9/python-3.11.9-embed-amd64.zip
    echo  2. Extract into: python-embed\
    echo  3. Run:  python-embed\python.exe get-pip.py
    echo  4. Run:  python-embed\python.exe -m pip install watchdog --target=python-embed
    echo  5. Edit: python-embed\python311._pth  ^(uncomment "import site"^)
    echo  6. Re-run build.bat
    echo.
    echo  See python-embed\README.md for full instructions.
    echo  Continuing build without bundled Python...
    echo.
)

REM ── 1. npm install ────────────────────────────────────────────────────────
echo [1/4] Installing npm deps...
call npm install --silent
if errorlevel 1 (echo [WARN] npm install had errors) else (echo [OK] npm deps ready)
echo.

REM ── 2. C engine DLL ───────────────────────────────────────────────────────
echo [2/4] Compiling C heuristic engine ^(ships prebuilt — users never need gcc^)...
set GCC_FOUND=0
set GCC_EXE=gcc

where gcc >nul 2>&1
if %errorlevel%==0 ( set GCC_FOUND=1 & set GCC_EXE=gcc & goto :do_gcc )
if exist "C:\msys64\mingw64\bin\gcc.exe"  set GCC_EXE=C:\msys64\mingw64\bin\gcc.exe  & set GCC_FOUND=1 & goto :do_gcc
if exist "C:\msys64\mingw32\bin\gcc.exe"  set GCC_EXE=C:\msys64\mingw32\bin\gcc.exe  & set GCC_FOUND=1 & goto :do_gcc
if exist "C:\mingw64\bin\gcc.exe"         set GCC_EXE=C:\mingw64\bin\gcc.exe         & set GCC_FOUND=1 & goto :do_gcc
if exist "C:\mingw32\bin\gcc.exe"         set GCC_EXE=C:\mingw32\bin\gcc.exe         & set GCC_FOUND=1 & goto :do_gcc
if exist "C:\MinGW\bin\gcc.exe"           set GCC_EXE=C:\MinGW\bin\gcc.exe           & set GCC_FOUND=1 & goto :do_gcc
if exist "C:\TDM-GCC-64\bin\gcc.exe"      set GCC_EXE=C:\TDM-GCC-64\bin\gcc.exe      & set GCC_FOUND=1 & goto :do_gcc

echo [SKIP] gcc not found - using existing prebuilt DLL
goto :after_gcc

:do_gcc
echo [..] Compiling with: %GCC_EXE%
"%GCC_EXE%" -O2 -shared -lm -o backend\c\libheuristic.dll backend\c\heuristic_engine.c
if errorlevel 1 (echo [FAIL] DLL compile failed) else (echo [OK] libheuristic.dll ready)

:after_gcc
echo.

REM ── 3. Rust engine ────────────────────────────────────────────────────────
echo [3/4] Building Rust hash verifier...
where cargo >nul 2>&1
if %errorlevel%==0 (
    cd backend\rust
    cargo build --release --quiet
    if errorlevel 1 (echo [FAIL] Rust build failed) else (echo [OK] Rust engine built)
    cd ..\..
) else (
    echo [SKIP] cargo not found - Python fallback active
)
echo.

REM ── 4. Package installer ──────────────────────────────────────────────────
echo [4/4] Building installer...
echo       Output: dist\BytesProtector-Setup-1.0.0.exe
echo.
call npm run build
if errorlevel 1 (
    echo.
    echo [FAIL] Build failed. Common fixes:
    echo   - Make sure Node.js 18+ is installed
    echo   - Delete node_modules and re-run build.bat
    echo   - Check assets\icon.png exists and is a valid .ico/.png
) else (
    echo.
    echo [OK] Installer built successfully^^!
    echo      dist\BytesProtector-Setup-1.0.0.exe
    if exist "python-embed\python.exe" (
        echo      Bundled Python: YES ^(zero dependencies for users^)
    ) else (
        echo      Bundled Python: NO ^(users need Python installed^)
    )
)
echo.
echo ===============================================
echo  Done^^! Ship:  dist\BytesProtector-Setup-1.0.0.exe
echo ===============================================
echo.
pause
