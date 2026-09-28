// Requirements
const {
    app,
    BrowserWindow,
    ipcMain,
    Menu,
    shell,
    nativeImage,
    Tray,
    session
} = require('electron')
const { autoUpdater } = require('electron-updater')
const crypto = require('crypto')
const ejse = require('ejs-electron')
const fs = require('fs')
const isDev = require('./app/assets/js/isdev')
const path = require('path')
const semver = require('semver')
const { pathToFileURL } = require('url')
const {
    AZURE_CLIENT_ID,
    MSFT_OPCODE,
    MSFT_REPLY_TYPE,
    MSFT_ERROR
} = require('./app/assets/js/ipcconstants')
const { setupIpcHandlers } = require('./ipc')

let minimizeOnClose = false
let isGameLaunch = false
// Set when the application really quits (tray, menu, update install...), so
// that the window is not just hidden while the game is running.
let isQuitting = false
let autoUpdaterListenersAdded = false

/**
 * Send an auto update notification to the launcher window, if it is open.
 */
function sendAutoUpdateNotification(...args) {
    if (win != null && !win.isDestroyed()) {
        win.webContents.send('autoUpdateNotification', ...args)
    }
}

// Setup auto updater.
function initAutoUpdater(data) {

    if(data){
        autoUpdater.allowPrerelease = true
    } else {
        // Defaults to true if application version contains prerelease components (e.g. 0.12.1-alpha.1)
        // autoUpdater.allowPrerelease = true
    }
    
    if(isDev){
        autoUpdater.autoInstallOnAppQuit = false
        autoUpdater.updateConfigPath = path.join(__dirname, 'dev-app-update.yml')
    }
    if(process.platform === 'darwin'){
        autoUpdater.autoDownload = false
    }

    // The window can be closed and re-created (tray): add the listeners only
    // once, they notify the current window.
    if(autoUpdaterListenersAdded){
        return
    }
    autoUpdaterListenersAdded = true

    autoUpdater.on('update-available', (info) => {
        sendAutoUpdateNotification('update-available', info)
    })
    autoUpdater.on('update-downloaded', (info) => {
        sendAutoUpdateNotification('update-downloaded', info)
    })
    autoUpdater.on('update-not-available', (info) => {
        sendAutoUpdateNotification('update-not-available', info)
    })
    autoUpdater.on('checking-for-update', () => {
        sendAutoUpdateNotification('checking-for-update')
    })
    autoUpdater.on('error', (err) => {
        sendAutoUpdateNotification('realerror', err)
    })
}

// Open channel to listen for update actions.
ipcMain.on('autoUpdateAction', (event, arg, data) => {
    switch(arg){
        case 'initAutoUpdater':
            console.log('Initializing auto updater.')
            initAutoUpdater(data)
            event.sender.send('autoUpdateNotification', 'ready')
            break
        case 'checkForUpdate':
            autoUpdater.checkForUpdates()
                .catch(err => {
                    event.sender.send('autoUpdateNotification', 'realerror', err)
                })
            break
        case 'allowPrereleaseChange':
            if(!data){
                const preRelComp = semver.prerelease(app.getVersion())
                if(preRelComp != null && preRelComp.length > 0){
                    autoUpdater.allowPrerelease = true
                } else {
                    autoUpdater.allowPrerelease = data
                }
            } else {
                autoUpdater.allowPrerelease = data
            }
            break
        case 'installUpdateNow':
            autoUpdater.quitAndInstall(true, true) //Silent installing and force run app after update
            break
        default:
            console.log('Unknown argument', arg)
            break
    }
})
// Redirect distribution index event from preloader to renderer.
ipcMain.on('distributionIndexDone', (event, res) => {
    event.sender.send('distributionIndexDone', res)
})

//Handle close action
ipcMain.on('onCloseAction', (event, arg, res) => {
    if(arg === 'closeAction'){
        minimizeOnClose = res
    }else if(arg === 'gameLaunch'){
        isGameLaunch = res
    }else{
        console.log('Unknown argument', arg)
    }
})

// Disable hardware acceleration.
// https://electronjs.org/docs/tutorial/offscreen-rendering
app.disableHardwareAcceleration()

const REDIRECT_URI = 'https://login.microsoftonline.com/common/oauth2/nativeclient'
const REDIRECT_URI_PREFIX = REDIRECT_URI + '?'
const MSFT_TOKEN_ENDPOINT = 'https://login.microsoftonline.com/consumers/oauth2/v2.0/token'

/**
 * Exchange the authorization code for Microsoft tokens (OAuth PKCE). Done here
 * because the main process is the only one to know the code verifier. Same
 * request as helios-core's MicrosoftAuth.getAccessToken, plus code_verifier.
 *
 * @param {string} code The authorization code.
 * @param {string} codeVerifier The PKCE code verifier of this login attempt.
 * @returns {Promise<Object>} The token response (access_token, refresh_token, expires_in...).
 */
async function exchangeMicrosoftAuthCode(code, codeVerifier) {
    const res = await fetch(MSFT_TOKEN_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            client_id: AZURE_CLIENT_ID,
            scope: 'XboxLive.signin offline_access',
            redirect_uri: REDIRECT_URI,
            grant_type: 'authorization_code',
            code,
            code_verifier: codeVerifier
        }),
        signal: AbortSignal.timeout(15000)
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok || typeof body.access_token !== 'string' || typeof body.refresh_token !== 'string') {
        throw new Error(`Microsoft token request failed (HTTP ${res.status}${body.error ? `, ${body.error}` : ''})`)
    }
    return body
}

// Microsoft Auth Login
let msftAuthWindow
let msftAuthSuccess
let msftAuthViewSuccess
let msftAuthViewOnClose
ipcMain.on(MSFT_OPCODE.OPEN_LOGIN, (ipcEvent, ...arguments_) => {
    if (msftAuthWindow) {
        ipcEvent.reply(MSFT_OPCODE.REPLY_LOGIN, MSFT_REPLY_TYPE.ERROR, MSFT_ERROR.ALREADY_OPEN, msftAuthViewOnClose)
        return
    }
    msftAuthSuccess = false
    msftAuthViewSuccess = arguments_[0]
    msftAuthViewOnClose = arguments_[1]
    // state ties the redirect to this login attempt, PKCE ties the authorization
    // code to this launcher: the code verifier never leaves the main process.
    const state = crypto.randomBytes(16).toString('base64url')
    const codeVerifier = crypto.randomBytes(32).toString('base64url')
    const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url')
    msftAuthWindow = new BrowserWindow({
        title: 'Connexion avec Microsoft',
        backgroundColor: '#222222',
        width: 520,
        height: 600,
        frame: true,
        icon: getPlatformIcon('ZukiLogo'),
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
            webSecurity: true,
            allowRunningInsecureContent: false
        }
    })

    msftAuthWindow.on('closed', () => {
        msftAuthWindow = undefined
    })

    msftAuthWindow.on('close', () => {
        if(!msftAuthSuccess) {
            ipcEvent.reply(MSFT_OPCODE.REPLY_LOGIN, MSFT_REPLY_TYPE.ERROR, MSFT_ERROR.NOT_FINISHED, msftAuthViewOnClose)
        }
    })

    msftAuthWindow.webContents.on('did-navigate', (_, uri) => {
        if (uri.startsWith(REDIRECT_URI_PREFIX)) {
            let queryMap = {}

            new URL(uri).searchParams.forEach((v, k) => {
                queryMap[k] = v
            })

            msftAuthSuccess = true
            msftAuthWindow.close()
            msftAuthWindow = null

            if (queryMap.state !== state) {
                console.error('Microsoft login: unexpected state, response ignored.')
                ipcEvent.reply(MSFT_OPCODE.REPLY_LOGIN, MSFT_REPLY_TYPE.ERROR, MSFT_ERROR.FAILED, msftAuthViewOnClose)
                return
            }

            if (queryMap.error != null) {
                // Error returned by Microsoft, displayed by the renderer.
                ipcEvent.reply(MSFT_OPCODE.REPLY_LOGIN, MSFT_REPLY_TYPE.SUCCESS, { error: queryMap.error, error_description: queryMap.error_description }, msftAuthViewSuccess)
                return
            }

            exchangeMicrosoftAuthCode(queryMap.code, codeVerifier).then(accessToken => {
                ipcEvent.reply(MSFT_OPCODE.REPLY_LOGIN, MSFT_REPLY_TYPE.SUCCESS, { accessToken }, msftAuthViewSuccess)
            }).catch(error => {
                console.error('Microsoft login: unable to get the tokens.', error)
                ipcEvent.reply(MSFT_OPCODE.REPLY_LOGIN, MSFT_REPLY_TYPE.ERROR, MSFT_ERROR.FAILED, msftAuthViewOnClose)
            })
        }
    })

    msftAuthWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    msftAuthWindow.removeMenu()
    msftAuthWindow.loadURL(`https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize?prompt=select_account&client_id=${AZURE_CLIENT_ID}&response_type=code&scope=XboxLive.signin%20offline_access&redirect_uri=${REDIRECT_URI}&state=${state}&code_challenge=${codeChallenge}&code_challenge_method=S256`)
})

// Microsoft Auth Logout
let msftLogoutWindow
let msftLogoutSuccess
let msftLogoutSuccessSent
ipcMain.on(MSFT_OPCODE.OPEN_LOGOUT, (ipcEvent, uuid, isLastAccount) => {
    if (msftLogoutWindow) {
        ipcEvent.reply(MSFT_OPCODE.REPLY_LOGOUT, MSFT_REPLY_TYPE.ERROR, MSFT_ERROR.ALREADY_OPEN)
        return
    }

    msftLogoutSuccess = false
    msftLogoutSuccessSent = false
    msftLogoutWindow = new BrowserWindow({
        title: 'Déconnexion de Microsoft',
        backgroundColor: '#222222',
        width: 520,
        height: 600,
        frame: true,
        icon: getPlatformIcon('ZukiLogo'),
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
            webSecurity: true,
            allowRunningInsecureContent: false
        }
    })

    msftLogoutWindow.on('closed', () => {
        msftLogoutWindow = undefined
    })

    msftLogoutWindow.on('close', () => {
        if(!msftLogoutSuccess) {
            ipcEvent.reply(MSFT_OPCODE.REPLY_LOGOUT, MSFT_REPLY_TYPE.ERROR, MSFT_ERROR.NOT_FINISHED)
        } else if(!msftLogoutSuccessSent) {
            msftLogoutSuccessSent = true
            ipcEvent.reply(MSFT_OPCODE.REPLY_LOGOUT, MSFT_REPLY_TYPE.SUCCESS, uuid, isLastAccount)
        }
    })
    
    msftLogoutWindow.webContents.on('did-navigate', (_, uri) => {
        if(uri.startsWith('https://login.microsoftonline.com/common/oauth2/v2.0/logoutsession')) {
            msftLogoutSuccess = true
            setTimeout(() => {
                if(!msftLogoutSuccessSent) {
                    msftLogoutSuccessSent = true
                    ipcEvent.reply(MSFT_OPCODE.REPLY_LOGOUT, MSFT_REPLY_TYPE.SUCCESS, uuid, isLastAccount)
                }

                if(msftLogoutWindow) {
                    msftLogoutWindow.close()
                    msftLogoutWindow = null
                }
            }, 5000)
        }
    })
    
    msftLogoutWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    msftLogoutWindow.removeMenu()
    msftLogoutWindow.loadURL('https://login.microsoftonline.com/common/oauth2/v2.0/logout')
})

let tray = null
function createTray () {
    const icon = getPlatformIcon('ZukiLogo') // required.
    const trayicon = nativeImage.createFromPath(icon)
    tray = new Tray(trayicon)
    const contextMenu = Menu.buildFromTemplate([
        {
            label: 'ZukiPalace Launcher', 
            type: 'normal', 
            enabled: false, 
            icon: trayicon.resize({ width: 16 })
        },
        {
            type: 'separator'
        },
        {
            label: 'Chercher des MAJ...',
            click: () => {
                if(!win){
                    createWindow()
                }
                if(!isDev){ 
                    autoUpdater.checkForUpdates().catch(() => {})
                }
            }
        },
        {
            type: 'separator'
        },
        {
            label: 'Quitter',
            click: () => {
                app.quit() // actually quit the app.
            }
        },
    ])

    tray.setContextMenu(contextMenu)
    tray.setToolTip('ZukiPalace Launcher')

    tray.on('click', () => {
        if(win){
            win.show()
        }else{
            createWindow()
        }
    })
}

function isSafeExternalUrl(url) {
    try {
        const parsed = new URL(url)
        if (['https:', 'mailto:'].includes(parsed.protocol)) {
            return true
        }
        return parsed.protocol === 'http:' && ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname)
    } catch {
        return false
    }
}

// Keep a global reference of the window object, if you don't, the window will
// be closed automatically when the JavaScript object is garbage collected.
let win

function createWindow() {

    if (!tray) { // if tray hasn't been created already.
        createTray()
    }

    win = new BrowserWindow({
        width: 980,
        height: 552,
        icon: getPlatformIcon('ZukiLogo'),
        frame: false,
        webPreferences: {
            disableBlinkFeatures: 'Auxclick',
            preload: path.join(__dirname, 'app', 'assets', 'js', 'preloader.js'),
            nodeIntegration: true,
            // Legacy compatibility: renderer scripts still consume constructors/prototypes
            // from Helios and the distribution model. Keep this false until those flows
            // are moved behind DTO-based IPC APIs.
            contextIsolation: false,
            sandbox: false,
            webSecurity: true,
            allowRunningInsecureContent: false,
            devTools: isDev,
            spellcheck: false,
            additionalArguments: [
                `--launcher-runtime=${Buffer.from(JSON.stringify({
                    version: app.getVersion(),
                    platform: process.platform,
                    arch: process.arch,
                    isDev,
                    appRoot: path.join(__dirname, 'app'),
                    paths: {
                        userData: app.getPath('userData'),
                        temp: app.getPath('temp'),
                        home: app.getPath('home'),
                        desktop: app.getPath('desktop')
                    }
                })).toString('base64url')}`
            ]
        },
        backgroundColor: '#171614'
    })

    ejse.data('bkid', Math.floor((Math.random() * fs.readdirSync(path.join(__dirname, 'app', 'assets', 'images', 'backgrounds')).length)))

    win.loadURL(pathToFileURL(path.join(__dirname, 'app', 'app.ejs')).toString())

    win.webContents.setWindowOpenHandler(({ url }) => {
        if (isSafeExternalUrl(url)) {
            shell.openExternal(url).catch(() => {})
        }
        return { action: 'deny' }
    })

    win.webContents.on('will-navigate', (event, url) => {
        const localUrl = pathToFileURL(path.join(__dirname, 'app', 'app.ejs')).toString()
        // This window has access to Node.js: only the launcher page may be
        // loaded in it, any other page (local files included) is refused.
        if (url !== localUrl) {
            event.preventDefault()
            if (isSafeExternalUrl(url)) {
                shell.openExternal(url).catch(() => {})
            }
        }
    })

    // Lets the renderer display its warning message in the console.
    win.webContents.on('devtools-opened', () => {
        win.webContents.send('window:devtoolsOpened')
    })

    win.removeMenu()

    win.resizable = true

    win.on('close', e => {
        // While the game is running, keep the launcher alive in the tray,
        // unless the user really quits it.
        if (isGameLaunch && !isQuitting) {
            e.preventDefault()
            win.hide()
        }
    })

    win.on('closed', () => {
        win = null
    })
}

function createMenu() {
    
    if(process.platform === 'darwin') {

        // Extend default included application menu to continue support for quit keyboard shortcut
        let applicationSubMenu = {
            label: 'Application',
            submenu: [{
                label: 'About Application',
                selector: 'orderFrontStandardAboutPanel:'
            }, {
                type: 'separator'
            }, {
                label: 'Quit',
                accelerator: 'Command+Q',
                click: () => {
                    app.quit()
                }
            }]
        }

        // New edit menu adds support for text-editing keyboard shortcuts
        let editSubMenu = {
            label: 'Edit',
            submenu: [{
                label: 'Undo',
                accelerator: 'CmdOrCtrl+Z',
                selector: 'undo:'
            }, {
                label: 'Redo',
                accelerator: 'Shift+CmdOrCtrl+Z',
                selector: 'redo:'
            }, {
                type: 'separator'
            }, {
                label: 'Cut',
                accelerator: 'CmdOrCtrl+X',
                selector: 'cut:'
            }, {
                label: 'Copy',
                accelerator: 'CmdOrCtrl+C',
                selector: 'copy:'
            }, {
                label: 'Paste',
                accelerator: 'CmdOrCtrl+V',
                selector: 'paste:'
            }, {
                label: 'Select All',
                accelerator: 'CmdOrCtrl+A',
                selector: 'selectAll:'
            }]
        }

        // Bundle submenus into a single template and build a menu object with it
        let menuTemplate = [applicationSubMenu, editSubMenu]
        let menuObject = Menu.buildFromTemplate(menuTemplate)

        // Assign it to the application
        Menu.setApplicationMenu(menuObject)

    }

}

function getPlatformIcon(filename){
    let ext
    switch(process.platform) {
        case 'win32':
            ext = 'ico'
            break
        case 'darwin':
        case 'linux':
        default:
            ext = 'png'
            break
    }

    return path.join(__dirname, 'app', 'assets', 'images', `${filename}.${ext}`)
}

// A second launcher would share the same config and game files: keep a single
// instance and bring its window back instead.
const gotSingleInstanceLock = app.requestSingleInstanceLock()

if (!gotSingleInstanceLock) {
    app.quit()
} else {
    app.on('second-instance', () => {
        if (!app.isReady()) {
            return
        }
        if (win == null) {
            createWindow()
            return
        }
        if (win.isMinimized()) {
            win.restore()
        }
        win.show()
        win.focus()
    })

    app.whenReady().then(() => {
        setupIpcHandlers(app)

        session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
            callback(false)
        })

        session.defaultSession.setPermissionCheckHandler(() => false)

        createMenu()
        createWindow()
    })
}

app.on('before-quit', () => {
    isQuitting = true
})

app.on('window-all-closed', () => {
    // On macOS it is common for applications and their menu bar
    // to stay active until the user quits explicitly with Cmd + Q
    if (process.platform !== 'darwin') {
        if (!isGameLaunch) {
            if (!minimizeOnClose) {
                app.quit()
            }
        } else {
            win && win.hide()
        }
    }
})

app.on('activate', () => {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (win === null) {
        createWindow()
    }
})