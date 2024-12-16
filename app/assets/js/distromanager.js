
const path = require('node:path')
const fs = require('node:fs')

const { LoggerUtil } = require('helios-core')
const { DistributionAPI } = require('helios-core/common')

const ConfigManager = require('./configmanager')

const logger = LoggerUtil.getLogger('DistroManager')

exports.REMOTE_DISTRO_URL = 'http://51.77.201.23/zuki-launcher/distribution.json'

const api = new DistributionAPI(
    ConfigManager.getLauncherDirectory(),
    null, // Injected forcefully by the preloader.
    null, // Injected forcefully by the preloader.
    exports.REMOTE_DISTRO_URL,
    false
)

const FOLDER_TYPE = {
    INSTANCES: 'INSTANCES',
    COMMON: 'COMMON'
}

function getAllFiles(folderPath, folderType, allFiles = false) {
    let filesList = []

    if (!fs.existsSync(folderPath) || !fs.lstatSync(folderPath).isDirectory()) {
        throw new Error('The given folder path is not a valid folder')
    }

    const traverseDirectory = (currentPath, firstLoop = true) => {
        const items = fs.readdirSync(currentPath)

        let hasFiles = false

        for (const item of items) {
            if (!allFiles) {
                if (firstLoop && folderType === FOLDER_TYPE.COMMON && item !== 'mods') {
                    continue
                }
    
                if (firstLoop && folderType === FOLDER_TYPE.INSTANCES && !['resourcepacks'].includes(item)) {
                    continue
                }
    
                if (folderType === FOLDER_TYPE.INSTANCES && item.includes('hs_err_pid')) {
                    continue
                }
            }

            const fullPath = path.join(currentPath, item)
            const stats = fs.lstatSync(fullPath)

            if (stats.isDirectory()) {
                traverseDirectory(fullPath, false)

                const directoryContent = fs.readdirSync(fullPath)
                if (directoryContent.length === 0) {
                    filesList.push(fullPath)
                } else {
                    hasFiles = true
                }
            } else if (stats.isFile()) {
                filesList.push(fullPath)
                hasFiles = true
            }
        }

        if (!hasFiles && !firstLoop) {
            filesList.push(currentPath)
        }
    }

    traverseDirectory(folderPath)

    return filesList
}

function getTotalSizeInMb(files) {
    if (!Array.isArray(files)) {
        throw new Error('Parameter needs to be an array of strings')
    }

    let totalSize = 0

    const calculateSize = filePath => {
        if (fs.existsSync(filePath)) {
            const stats = fs.lstatSync(filePath)

            if (stats.isFile()) {
                totalSize += stats.size
            } else if (stats.isDirectory()) {
                const dirFiles = fs.readdirSync(filePath).map(name => path.join(filePath, name))
                for (const dirFile of dirFiles) {
                    calculateSize(dirFile)
                }
            }
        } else {
            logger.warn(`Path not found or invalid: ${filePath}`)
        }
    }

    for (const file of files) {
        calculateSize(file)
    }

    return (totalSize / (1024 * 1024)).toFixed(2)
}

exports.getFilesToDelete = async (
    {
        deleteOldModVersion = false,
        deleteOldResourcePackVersion = false,
        deleteOldDistro = false
    } = {}
) => {
    if (!deleteOldDistro && !deleteOldModVersion && !deleteOldResourcePackVersion) {
        return []
    }

    let { instanceDir, commonDir } = api

    if (!instanceDir) {
        instanceDir = ConfigManager.getInstanceDirectory()
    }

    if (!commonDir) {
        commonDir = ConfigManager.getCommonDirectory()
    }

    const distro = await api.getDistribution()
    const server = distro.getServerById(ConfigManager.getSelectedServer())

    if (!server) {
        return []
    }

    const filesToDelete = new Set()

    if(deleteOldDistro) {
        const currentDistroFoldersNames = distro.servers.map(e => e.rawServer.id)
        const currentFolderNames = fs.readdirSync(instanceDir)

        const oldDistroFolders = currentFolderNames.filter(e => !currentDistroFoldersNames.includes(e)).map(e => path.join(instanceDir, e))

        for (const folder of oldDistroFolders) {
            filesToDelete.add(folder)
        }
    }

    if (deleteOldModVersion) {
        const commonDirFiles = getAllFiles(commonDir, FOLDER_TYPE.COMMON)

        for (const file of commonDirFiles) {
            filesToDelete.add(file)
        }
    }

    const modulesPaths = server.modules.map(e => e.getPath())

    // if (deleteOldResourcePackVersion) {
    //     const instanceDirFiles = getAllFiles(path.join(instanceDir, ConfigManager.getSelectedServer()), FOLDER_TYPE.INSTANCES).map(e => e.split('\\').pop())
    //     const defaultResourcePacks = modulesPaths.filter(e => e.includes('resourcepacks')).map(e => e.split('\\').pop())

    //     for (const file of instanceDirFiles) {
    //         filesToDelete.add(file)
    //     }
    // }

    const files = [...filesToDelete].filter(e => !modulesPaths.includes(e))

    return files
}

exports.calculateFreeableSpace = async (
    {
        deleteOldModVersion,
        deleteOldResourcePackVersion,
        deleteOldDistro
    } = { deleteOldModVersion: false, deleteOldResourcePackVersion: false, deleteOldDistro: false }
) => {
    const files = await exports.getFilesToDelete({ deleteOldDistro, deleteOldModVersion, deleteOldResourcePackVersion })
    return { numberOfFiles: files.length, size: getTotalSizeInMb(files) }
}

exports.cleanOldDistroFiles = async (
    {
        deleteOldModVersion,
        deleteOldResourcePackVersion,
        deleteOldDistro
    } = { deleteOldModVersion: false, deleteOldResourcePackVersion: false, deleteOldDistro: false }
) => {
    const files = await exports.getFilesToDelete({ deleteOldDistro, deleteOldModVersion, deleteOldResourcePackVersion })

    logger.info(`Delete ${files.length} files or directories`)

    for (const file of files) {
        const stats = fs.lstatSync(file)
        fs.rmSync(file, { force: true, recursive: stats.isDirectory() })
    }
}

exports.DistroAPI = api
