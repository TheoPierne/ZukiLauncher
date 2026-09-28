'use strict'

const { BrowserWindow, clipboard, dialog, ipcMain, safeStorage, shell } = require('electron')
const fs = require('fs-extra')
const os = require('os')
const path = require('path')
const { fileURLToPath } = require('url')
const { SHELL_OPCODE } = require('./app/assets/js/ipcconstants')

// The only page allowed to use these handlers (see createWindow in index.js).
const APP_PAGE_PATH = path.join(__dirname, 'app', 'app.ejs')

// Files that the renderer may move to the trash: drop-in mods and shaderpacks.
const TRASHABLE_FILE = /\.(jar|zip|litemod)(\.disabled)?$/i

function getSenderWindow(event) {
    return BrowserWindow.fromWebContents(event.sender)
}

/**
 * Check that an IPC message comes from the top frame of the launcher page,
 * not from another page or frame loaded in a window.
 *
 * @param {import('electron').IpcMainEvent | import('electron').IpcMainInvokeEvent} event
 * @returns {boolean} True if the sender is trusted.
 */
function isTrustedSender(event) {
    const frame = event.senderFrame
    if (frame == null || frame.parent != null) {
        return false
    }

    try {
        const url = new URL(frame.url)
        if (url.protocol !== 'file:') {
            return false
        }
        const framePath = path.resolve(fileURLToPath(url))
        return process.platform === 'win32'
            ? framePath.toLowerCase() === APP_PAGE_PATH.toLowerCase()
            : framePath === APP_PAGE_PATH
    } catch {
        return false
    }
}

function onTrusted(channel, listener) {
    ipcMain.on(channel, (event, ...args) => {
        if (!isTrustedSender(event)) {
            console.warn(`IPC "${channel}" ignoré : émetteur non autorisé (${event.senderFrame?.url}).`)
            return
        }
        listener(event, ...args)
    })
}

function handleTrusted(channel, listener) {
    ipcMain.handle(channel, (event, ...args) => {
        if (!isTrustedSender(event)) {
            throw new Error(`Émetteur non autorisé pour le canal IPC ${channel}`)
        }
        return listener(event, ...args)
    })
}

function isSafeStorageUsable() {
    // macOS: unsigned builds would trigger a keychain prompt after each update,
    // to be enabled once the app is signed. Linux without a keyring falls back
    // to a hardcoded key, which gives no real protection.
    if (process.platform === 'darwin' || !safeStorage.isEncryptionAvailable()) {
        return false
    }
    return process.platform !== 'linux' || !['basic_text', 'unknown'].includes(safeStorage.getSelectedStorageBackend())
}

// Note: dataDirectory is still read from config.json, which the renderer
// writes. The handlers using these roots therefore only allow narrow
// operations (opening folders, trashing mods).
function getAllowedFileRoots(app) {
    const roots = new Set([
        app.getPath('userData'),
        app.getPath('temp')
    ])

    try {
        const configPath = path.join(app.getPath('userData'), 'config.json')
        if (fs.existsSync(configPath)) {
            const config = fs.readJsonSync(configPath)
            const dataDirectory = config?.settings?.launcher?.dataDirectory
            if (typeof dataDirectory === 'string' && dataDirectory.trim() !== '') {
                roots.add(dataDirectory)
            }
        }
    } catch {
        // Ignore malformed config files for IPC root resolution.
    }

    return [...roots]
}

function normalizeInside(targetPath, allowedRoots) {
    if (typeof targetPath !== 'string' || targetPath.trim() === '') {
        throw new Error('Chemin invalide')
    }

    const resolved = path.resolve(targetPath)
    const allowed = allowedRoots.some(root => {
        const resolvedRoot = path.resolve(root)
        return resolved === resolvedRoot || resolved.startsWith(resolvedRoot + path.sep)
    })

    if (!allowed) {
        throw new Error('Accès refusé au chemin demandé')
    }

    return resolved
}

function serializeError(error) {
    return {
        message: error?.message || String(error),
        name: error?.name || 'Error'
    }
}

function isSafeExternalUrl(url) {
    if (typeof url !== 'string') {
        return false
    }

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

function sanitizeOpenDialogOptions(options = {}) {
    const allowedProperties = new Set(['openFile', 'openDirectory', 'multiSelections', 'createDirectory', 'showHiddenFiles'])
    const properties = Array.isArray(options.properties)
        ? options.properties.filter(property => allowedProperties.has(property))
        : ['openFile']

    const result = { properties }

    if (typeof options.title === 'string' && options.title.length <= 120) {
        result.title = options.title
    }

    if (Array.isArray(options.filters)) {
        result.filters = options.filters
            .filter(filter => typeof filter?.name === 'string' && Array.isArray(filter.extensions))
            .map(filter => ({
                name: filter.name.slice(0, 80),
                extensions: filter.extensions
                    .filter(ext => typeof ext === 'string' && /^[a-z0-9*]+$/i.test(ext))
                    .slice(0, 20)
            }))
            .filter(filter => filter.extensions.length > 0)
            .slice(0, 10)
    }

    return result
}

/**
 * Initialize IPC handlers.
 * @param {import('electron').App} app
 */
exports.setupIpcHandlers = (app) => {
    const allowedFileRoots = () => getAllowedFileRoots(app)

    onTrusted('window:minimize', (event) => {
        const target = getSenderWindow(event)
        target?.minimize()
    })

    onTrusted('window:maximizeToggle', (event) => {
        const target = getSenderWindow(event)
        if (!target) return

        if (target.isMaximized()) {
            target.unmaximize()
        } else {
            target.maximize()
        }
    })

    onTrusted('window:close', (event) => {
        getSenderWindow(event)?.close()
    })

    handleTrusted('window:isMaximized', (event) => {
        return getSenderWindow(event)?.isMaximized() ?? false
    })

    onTrusted('window:toggleDevTools', (event) => {
        const target = getSenderWindow(event)
        target?.webContents.toggleDevTools()
    })

    handleTrusted('window:setProgressBar', (event, progress) => {
        const target = getSenderWindow(event)
        if (!target) return false

        const value = Number(progress)
        if (!Number.isFinite(value)) {
            throw new Error('Progression invalide')
        }

        target.setProgressBar(Math.max(-1, Math.min(2, value)))
        return true
    })

    handleTrusted('app:getVersion', () => app.getVersion())

    handleTrusted('app:getPlatform', () => ({
        platform: process.platform,
        arch: process.arch
    }))

    handleTrusted('app:getPaths', () => ({
        userData: app.getPath('userData'),
        temp: app.getPath('temp'),
        home: app.getPath('home'),
        desktop: app.getPath('desktop')
    }))

    handleTrusted('system:getMemory', () => ({
        total: os.totalmem(),
        free: os.freemem()
    }))

    handleTrusted('clipboard:writeText', (_event, text) => {
        if (typeof text !== 'string') {
            throw new Error('Texte invalide')
        }

        clipboard.writeText(text)
        return true
    })

    handleTrusted('shell:openExternal', async (_event, url) => {
        if (!isSafeExternalUrl(url)) {
            throw new Error('URL invalide')
        }

        await shell.openExternal(url)
        return true
    })

    handleTrusted('shell:openPath', async (_event, targetPath) => {
        const safePath = normalizeInside(targetPath, allowedFileRoots())
        // Opening a file would run it with its default application: folders only.
        if (!(await fs.stat(safePath)).isDirectory()) {
            throw new Error('Seuls les dossiers peuvent être ouverts')
        }
        return shell.openPath(safePath)
    })

    handleTrusted('shell:beep', () => {
        if (typeof shell.beep === 'function') {
            shell.beep()
        } else {
            process.stdout.write('\x07')
        }
        return true
    })

    handleTrusted(SHELL_OPCODE.TRASH_ITEM, async (_event, targetPath) => {
        try {
            const safePath = normalizeInside(targetPath, allowedFileRoots())
            // Only drop-in mods and shaderpacks are deleted from the launcher.
            const stats = await fs.lstat(safePath)
            if (!stats.isFile() || !TRASHABLE_FILE.test(safePath)) {
                throw new Error('Seuls les mods et les shaderpacks peuvent être supprimés')
            }
            await shell.trashItem(safePath)
            return { result: true }
        } catch (error) {
            return { result: false, error: serializeError(error) }
        }
    })

    handleTrusted('dialog:showOpenDialog', async (event, options) => {
        const target = getSenderWindow(event)
        if (!target) {
            return { canceled: true, filePaths: [] }
        }

        return dialog.showOpenDialog(target, sanitizeOpenDialogOptions(options))
    })

    handleTrusted('path:join', (_event, parts) => {
        if (!Array.isArray(parts) || !parts.every(part => typeof part === 'string')) {
            throw new Error('Segments de chemin invalides')
        }

        return path.join(...parts)
    })

    handleTrusted('path:dirname', (_event, targetPath) => {
        if (typeof targetPath !== 'string') throw new Error('Chemin invalide')
        return path.dirname(targetPath)
    })

    handleTrusted('path:basename', (_event, targetPath) => {
        if (typeof targetPath !== 'string') throw new Error('Chemin invalide')
        return path.basename(targetPath)
    })

    // Token encryption for configmanager.js, synchronous because the config is
    // loaded and saved synchronously. A null return value means that the value
    // must be kept as is (encryption) or cannot be decrypted (decryption).
    // No page check: the config is loaded by the preload script, before the
    // page itself, and the main window can only display the launcher page
    // (see will-navigate in index.js).
    ipcMain.on('safeStorage:encrypt', (event, value) => {
        let result = null
        try {
            if (event.senderFrame?.parent == null && typeof value === 'string' && isSafeStorageUsable()) {
                result = safeStorage.encryptString(value).toString('base64')
            }
        } catch (error) {
            console.warn('Chiffrement safeStorage impossible.', error)
        }
        event.returnValue = result
    })

    ipcMain.on('safeStorage:decrypt', (event, value) => {
        let result = null
        try {
            if (event.senderFrame?.parent == null && typeof value === 'string' && safeStorage.isEncryptionAvailable()) {
                result = safeStorage.decryptString(Buffer.from(value, 'base64'))
            }
        } catch (error) {
            console.warn('Déchiffrement safeStorage impossible.', error)
        }
        event.returnValue = result
    })
}
