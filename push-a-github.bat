@echo off
setlocal enabledelayedexpansion
chcp 65001 > nul
cd /d "%~dp0"

echo.
echo ========================================
echo   ConsultoraDemo - Push a GitHub
echo ========================================
echo.

REM Verificar git
git --version > nul 2>&1
if errorlevel 1 (
    echo [ERROR] Git no esta instalado.
    echo Bajalo de https://git-scm.com/download/win e instalalo.
    echo Despues volve a ejecutar este script.
    pause
    exit /b 1
)

REM Limpiar .git roto si existe
if exist ".git" (
    echo Limpiando .git previo...
    rmdir /s /q .git 2>nul
)

REM Inicializar repo
echo Inicializando repositorio...
git init -b main
if errorlevel 1 goto :error

git config user.email "lautaroeroveda@gmail.com"
git config user.name "Lauti"

REM Add y commit
echo Agregando archivos...
git add .
git commit -m "Initial commit: ConsultoraDemo - generador de informes HyS con IA"
if errorlevel 1 goto :error

REM Pedir la URL del repo
echo.
echo ----------------------------------------
echo Antes de seguir, asegurate de haber creado el repo VACIO en GitHub:
echo   1. Andate a https://github.com/new
echo   2. Nombre del repo: consultora-demo
echo   3. NO marques "Add a README" ni .gitignore (ya los tenemos)
echo   4. Crea el repo y copia la URL HTTPS (formato: https://github.com/usuario/consultora-demo.git)
echo ----------------------------------------
echo.
set /p REPO_URL=Pegá la URL del repo de GitHub:

if "!REPO_URL!"=="" (
    echo [ERROR] No ingresaste URL.
    pause
    exit /b 1
)

REM Conectar al remote y push
echo.
echo Conectando con GitHub...
git remote add origin !REPO_URL!
if errorlevel 1 goto :error

echo Empujando código...
git push -u origin main
if errorlevel 1 (
    echo.
    echo [ERROR] El push falló. Posibles causas:
    echo   - URL del repo incorrecta
    echo   - Falta autenticación. La primera vez Git Credential Manager
    echo     debería abrir tu navegador para que loguees en GitHub.
    echo   - Si tu repo NO está vacío, corré: git pull origin main --rebase
    echo     y volvé a ejecutar este script.
    pause
    exit /b 1
)

echo.
echo ========================================
echo   LISTO. El código está en GitHub.
echo ========================================
echo.
echo Próximos pasos para Vercel:
echo   1. Andate a https://vercel.com/new
echo   2. Conectá tu cuenta de GitHub
echo   3. Importá el repo consultora-demo
echo   4. Click "Deploy" (no necesita configuración, es estático)
echo.
pause
exit /b 0

:error
echo.
echo [ERROR] Algo falló. Revisá el mensaje arriba.
pause
exit /b 1
