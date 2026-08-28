# Instalación de Local AI Remote en Windows

Esta guía instala Local AI Remote en una PC Windows, configura el archivo `.env` y lo registra como un servicio que arranca automáticamente.

## 1. Programas que debes descargar

Instala estos programas antes de comenzar:

1. **Node.js LTS**: [nodejs.org/en/download](https://nodejs.org/en/download)
2. **WinSW**: [github.com/winsw/winsw/releases](https://github.com/winsw/winsw/releases)
3. **LM Studio**, si utilizarás ese proveedor: [lmstudio.ai/download](https://lmstudio.ai/download)
4. **Ollama**, si utilizarás ese proveedor: [ollama.com/download/windows](https://ollama.com/download/windows)
5. **Tailscale**, si accederás desde otra máquina: [tailscale.com/download/windows](https://tailscale.com/download/windows)

### Archivo necesario de WinSW

En la página de releases de WinSW descarga el ejecutable estable para Windows x64. Puede aparecer con un nombre parecido a `WinSW-x64.exe`.

Renómbralo exactamente a:

```text
LocalAIRemote.exe
```

Después colócalo en:

```text
C:\Apps\local-ai-remote\scripts\windows\LocalAIRemote.exe
```

El ejecutable y el archivo XML de configuración deben estar en la misma carpeta. El instalador genera automáticamente `LocalAIRemote.xml`.

## 2. Clonar el proyecto

Abre PowerShell y ejecuta:

```powershell
New-Item -ItemType Directory -Force -Path C:\Apps | Out-Null
git clone https://github.com/brugiafredo/LocalAIRemote-ui.git C:\Apps\local-ai-remote
cd C:\Apps\local-ai-remote
```

Si el proyecto se copia como ZIP, extrae su contenido directamente en:

```text
C:\Apps\local-ai-remote
```

Comprueba que exista `package.json` en esa carpeta.

## 3. Instalar dependencias

```powershell
cd C:\Apps\local-ai-remote
npm install
```

Comprueba la instalación:

```powershell
node --version
npm --version
```

## 4. Crear y configurar `.env`

### Instalación manual

Si sólo quieres ejecutar la aplicación desde una terminal:

```powershell
Copy-Item .env.example .env
notepad .env
```

### Instalación como servicio

El instalador del servicio crea `.env` automáticamente desde `.env.example` si todavía no existe. Nunca sobrescribe un `.env` existente.

Por tanto, si vas a instalar el servicio puedes dejar que el script lo cree. Después revisa el archivo si necesitas cambiar puertos o URLs:

```powershell
notepad C:\Apps\local-ai-remote\.env
```

Configuración por defecto:

```env
PORT=3000
HOST=0.0.0.0
LM_STUDIO_URL=http://127.0.0.1:1234
OLLAMA_URL=http://127.0.0.1:11434
APP_NAME=Local AI
NODE_ENV=production
```

El archivo `.env` no se sube a Git. Sólo `.env.example` se versiona.

## 5. Comprobar el proyecto antes del servicio

Ejecuta:

```powershell
npm run typecheck
npm run test
npm run build
```

Si los tres comandos terminan correctamente, la aplicación está compilada en:

```text
C:\Apps\local-ai-remote\apps\web\dist
C:\Apps\local-ai-remote\apps\server\dist
```

## 6. Ejecutar manualmente por primera vez

Antes de crear el servicio puedes probarlo así:

```powershell
npm run start
```

Abre en el navegador:

```text
http://localhost:3000
```

Para detenerlo, pulsa `Ctrl+C`.

## 7. Preparar LM Studio y Ollama

Puedes utilizar uno o los dos proveedores.

### LM Studio

1. Abre LM Studio.
2. Descarga al menos un modelo.
3. Abre la sección **Developer**.
4. Activa el servidor API en el puerto `1234`.

### Ollama

Instala al menos un modelo, por ejemplo:

```powershell
ollama pull llama3.2
```

Ollama normalmente queda disponible en:

```text
http://127.0.0.1:11434
```

La aplicación continuará funcionando si uno de los dos proveedores está apagado.

## 8. Instalar Local AI Remote como servicio Windows

Abre **PowerShell como Administrador** y ejecuta:

```powershell
cd C:\Apps\local-ai-remote
.\scripts\windows\install-service.ps1 -ProjectRoot "C:\Apps\local-ai-remote"
```

El script realiza estas acciones:

1. Crea `.env` desde `.env.example` si falta.
2. Conserva el `.env` existente si ya estaba configurado.
3. Comprueba que WinSW esté en `scripts\windows\LocalAIRemote.exe`.
4. Comprueba que exista el build de producción.
5. Genera `scripts\windows\LocalAIRemote.xml`.
6. Instala el servicio `LocalAIRemote`.
7. Configura inicio automático.
8. Arranca el servicio.
9. Configura reinicio automático si el proceso falla.

Comprueba el estado:

```powershell
Get-Service -Name LocalAIRemote
```

También puedes comprobar la aplicación:

```powershell
Invoke-WebRequest http://localhost:3000/api/health
```

El servicio ejecuta:

```text
node apps/server/dist/index.js
```

Si el servicio no inicia, comprueba que `node` esté disponible en el `PATH` de la cuenta que ejecuta servicios de Windows. También revisa los logs en:

```text
C:\Apps\local-ai-remote\logs
```

## 9. Acceder desde otra PC o iPhone con Tailscale

Instala Tailscale en la PC Windows y en el dispositivo cliente. Inicia sesión en la misma red de Tailscale.

En Windows, obtén la IP con:

```powershell
tailscale ip -4
```

Desde el navegador del iPhone, Mac u otra PC, abre:

```text
http://IP_DE_TAILSCALE:3000
```

Ejemplo:

```text
http://100.106.130.118:3000
```

## 10. Firewall de Windows

Si Tailscale no puede conectarse, abre PowerShell como Administrador y permite el puerto 3000:

```powershell
New-NetFirewallRule `
  -DisplayName "Local AI Remote TCP 3000" `
  -Direction Inbound `
  -Protocol TCP `
  -LocalPort 3000 `
  -Action Allow `
  -Profile Private
```

El proyecto no modifica el firewall automáticamente. No abras el puerto directamente a Internet; utiliza Tailscale o una red privada.

## 11. Actualizar una instalación existente

Desde PowerShell como Administrador:

```powershell
cd C:\Apps\local-ai-remote
git pull origin master
npm install
npm run typecheck
npm run test
npm run build
.\scripts\windows\install-service.ps1 -ProjectRoot "C:\Apps\local-ai-remote"
```

El `.env` existente se conserva durante la actualización.

## 12. Desinstalar el servicio

```powershell
cd C:\Apps\local-ai-remote
.\scripts\windows\uninstall-service.ps1
```

Esto elimina el servicio, pero no borra el proyecto ni `.env`.

## 13. Problemas frecuentes

### `WinSW executable not found`

Comprueba que el archivo se llame exactamente:

```text
LocalAIRemote.exe
```

y esté en:

```text
C:\Apps\local-ai-remote\scripts\windows
```

### `Production build not found`

Ejecuta:

```powershell
cd C:\Apps\local-ai-remote
npm install
npm run build
```

### Un proveedor aparece offline

Comprueba que LM Studio u Ollama estén ejecutándose y que las URLs de `.env` coincidan con sus puertos.

### El servicio arranca y se detiene

Comprueba:

```powershell
Get-Service -Name LocalAIRemote
Get-Content C:\Apps\local-ai-remote\logs\* -Tail 100
```

También verifica que Node.js esté disponible para la cuenta del servicio.

## 14. Seguridad y auditoría

Antes de publicar una instalación en producción, revisa:

```powershell
npm audit
```

El estado auditado del MVP mantiene un aviso high en `@fastify/static` que requiere revisar un upgrade mayor. No utilices `npm audit fix --force` sin probar antes el cambio.
