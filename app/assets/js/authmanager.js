/**
* AuthManager
* 
* This module aims to abstract login procedures. Results from Mojang's REST api
* are retrieved through our Mojang module. These results are processed and stored,
* if applicable, in the config using the ConfigManager. All login procedures should
* be made through this module.
* 
* @module authmanager
*/
// Requirements
const { v5: uuidv5 } = require('uuid')
const { machineIdSync } = require('node-machine-id')
const ConfigManager          = require('./configmanager')
const { LoggerUtil }         = require('helios-core')
const { RestResponseStatus } = require('helios-core/common')
const { MojangRestAPI, MojangErrorCode } = require('helios-core/mojang')
const { MicrosoftAuth, MicrosoftErrorCode } = require('helios-core/microsoft')
const { AZURE_CLIENT_ID }    = require('./ipcconstants')

const log = LoggerUtil.getLogger('AuthManager')

// Functions

function microsoftErrorDisplayable(errorCode) {
    switch(errorCode) {
        case MicrosoftErrorCode.NO_PROFILE:
            return {
                title: 'Erreur lors de la connexion :<br>Profil non configuré',
                desc: 'Votre compte Microsoft n\'a pas encore de profil Minecraft configuré. Si vous avez récemment acheté le jeu ou l\'avez utilisé via Xbox Game Pass, vous devez configurer votre profil sur <a href="https://minecraft.net/">Minecraft.net</a>.<br><br>Si vous n\'avez pas encore acheté le jeu, vous pouvez également le faire sur <a href="https://minecraft.net/">Minecraft.net</a>.'
            }
        case MicrosoftErrorCode.NO_XBOX_ACCOUNT:
            return {
                title: 'Erreur lors de la connexion :<br>Pas de compte Xbox',
                desc: 'Votre compte Microsoft n\'est associé à aucun compte Xbox.'
            }
        case MicrosoftErrorCode.XBL_BANNED:
            return {
                title: 'Erreur lors de la connexion :<br>Xbox Live indisponible',
                desc: 'Votre compte Microsoft provient d\'un pays où Xbox Live n\'est pas disponible ou interdit.'
            }
        case MicrosoftErrorCode.UNDER_18:
            return {
                title: 'Erreur lors de la connexion :<br>Approbation parentale requise',
                desc: 'Les comptes des utilisateurs de moins de 18 ans doivent être ajoutés à une famille par un adulte.'
            }
        case MicrosoftErrorCode.UNKNOWN:
            return {
                title: 'Erreur inconnue lors de la connexion',
                desc: 'Une erreur inconnue s\'est produite. Veuillez consulter la console pour plus de détails. (CTRL+Shift+I)'
            }
    }
}

function mojangErrorDisplayable(errorCode) {
    switch(errorCode) {
        case MojangErrorCode.ERROR_METHOD_NOT_ALLOWED:
            return {
                title: 'Erreur interne :<br>Méthode non autorisée',
                desc: 'Méthode non autorisée. Veuillez signaler cette erreur. (CTRL+Shift+I)'
            }
        case MojangErrorCode.ERROR_NOT_FOUND:
            return {
                title: 'Erreur interne :<br>Non trouvé',
                desc: 'Le point de terminaison d\'authentification n\'a pas été trouvé. Veuillez signaler ce problème. (CTRL+Shift+I)'
            }
        case MojangErrorCode.ERROR_USER_MIGRATED:
            return {
                title: 'Erreur lors de la connexion :<br>Compte migré',
                desc: 'Vous avez tenté de vous connecter avec un compte migré. Réessayez en utilisant l\'e-mail du compte comme nom d\'utilisateur.'
            }
        case MojangErrorCode.ERROR_INVALID_CREDENTIALS:
            return {
                title: 'Erreur lors de la connexion :<br>Informations d\'identification non valides',
                desc: 'L\'email ou le mot de passe que vous avez saisi est incorrect. Veuillez réessayer.'
            }
        case MojangErrorCode.ERROR_RATELIMIT:
            return {
                title: 'Erreur lors de la connexion :<br>Trop de tentatives',
                desc: 'Il y a eu trop de tentatives de connexion avec ce compte récemment. Veuillez réessayer plus tard.'
            }
        case MojangErrorCode.ERROR_INVALID_TOKEN:
            return {
                title: 'Erreur lors de la connexion :<br>Jeton invalide',
                desc: 'Le jeton d\'accès fourni n\'est pas valide.'
            }
        case MojangErrorCode.ERROR_ACCESS_TOKEN_HAS_PROFILE:
            return {
                title: 'Erreur lors de la connexion :<br>Le jeton a un profil',
                desc: 'Le jeton d\'accès possède déjà un profil attribué. La sélection des profils n\'est pas encore implémentée.'
            }
        case MojangErrorCode.ERROR_CREDENTIALS_MISSING:
            return {
                title: 'Erreur lors de la connexion :<br>Informations d\'identification manquantes',
                desc: 'Le nom d\'utilisateur/mot de passe n\'a pas été soumis ou le mot de passe comporte moins de 3 caractères.'
            }
        case MojangErrorCode.ERROR_INVALID_SALT_VERSION:
            return {
                title: 'Erreur lors de la connexion :<br>Version de sel non valide',
                desc: 'Version de sel non valide.'
            }
        case MojangErrorCode.ERROR_UNSUPPORTED_MEDIA_TYPE:
            return {
                title: 'Erreur interne :<br>Type de média non pris en charge',
                desc: 'Type de média non pris en charge. Veuillez signaler cette erreur. (CTRL+Shift+I)'
            }
        case MojangErrorCode.ERROR_GONE:
            return {
                title: 'Erreur lors de la connexion :<br>Compte migré',
                desc: 'Le compte a été migré vers un compte Microsoft. Veuillez vous connecter avec Microsoft.'
            }
        case MojangErrorCode.ERROR_UNREACHABLE:
            return {
                title: 'Erreur lors de la connexion :<br>Inaccessible',
                desc: 'Impossible d\'accéder aux serveurs d\'authentification. Assurez-vous qu\'ils sont en ligne et que vous êtes connecté à Internet.'
            }
        case MojangErrorCode.ERROR_NOT_PAID:
            return {
                title: 'Erreur lors de la connexion :<br>Jeu non acheté',
                desc: 'Le compte avec lequel vous essayez de vous connecter n\'a pas acheté de copie de Minecraft.<br>Vous pouvez acheter une copie sur <a href="https://minecraft.net/">Minecraft.net</a> ou vous créer un compte gratuit dans ce launcher.'
            }
        case MojangErrorCode.UNKNOWN:
            return {
                title: 'Erreur inconnue lors de la connexion',
                desc: 'Une erreur inconnue s\'est produite. Veuillez consulter la console pour plus de détails. (CTRL+Shift+I)'
            }
        default:
            throw new Error(`Unknown error code: ${errorCode}`)
    }
}

/**
* Add a Mojang account. This will authenticate the given credentials with Mojang's
* authserver. The resultant data will be stored as an auth account in the
* configuration database.
* 
* @param {string} username The account username (email if migrated).
* @param {string} password The account password.
* @returns {Promise.<Object>} Promise which resolves the resolved authenticated account object.
*/
exports.addMojangAccount = async function(username, password) {
    try {
        const response = await MojangRestAPI.authenticate(username, password, ConfigManager.getClientToken())
        if(response.responseStatus === RestResponseStatus.SUCCESS) {

            const session = response.data
            if(session.selectedProfile != null){
                const ret = ConfigManager.addMojangAuthAccount(session.selectedProfile.id, session.accessToken, username, session.selectedProfile.name)
                if(ConfigManager.getClientToken() == null){
                    ConfigManager.setClientToken(session.clientToken)
                }
                ConfigManager.save()
                return ret
            } else {
                return Promise.reject(mojangErrorDisplayable(MojangErrorCode.ERROR_NOT_PAID))
            }

        } else {
            return Promise.reject(mojangErrorDisplayable(response.mojangErrorCode))
        }
        
    } catch (err){
        log.error(err)
        return Promise.reject(mojangErrorDisplayable(MojangErrorCode.UNKNOWN))
    }
}

/**
* Add an unofficial account. The resultant data will be stored as an auth account in the
* configuration database.
* 
* @param {string} username The account username.
* @returns {Promise<Object>} Promise which resolves the resolved authenticated account object.
*/
exports.addUnofficalAccount = async function(username) {
    try {
        if (!['WOUHAIT', 'KNIGHTKENOBI_'].includes(username.toUpperCase())) {
            const uuid = uuidv5(username + machineIdSync(), uuidv5.DNS).replaceAll('-', '')
            const ret = ConfigManager.addUnofficalAuthAccount(uuid, username, username)
            if(ConfigManager.getClientToken() == null){
                ConfigManager.setClientToken('00000000000000000000000000000000')
            }
            ConfigManager.save()
            return ret
        } else {
            return Promise.reject({
                title: 'Erreur avec le Pseudo',
                desc: 'Une erreur s\'est produite. Vous ne pouvez pas utiliser le même pseudo qu\'un administrateur du serveur.'
            })
        }       
    } catch (err){
        log.error(err)
        return Promise.reject(mojangErrorDisplayable(MojangErrorCode.UNKNOWN))
    }
}

const AUTH_MODE = { FULL: 0, MS_REFRESH: 1, MC_REFRESH: 2 }

/**
* Perform the full MS Auth flow in a given mode.
* 
* AUTH_MODE.FULL = Full authorization for a new account.
* AUTH_MODE.MS_REFRESH = Full refresh authorization.
* AUTH_MODE.MC_REFRESH = Refresh of the MC token, reusing the MS token.
* 
* @param {string} entryCode FULL-AuthCode. MS_REFRESH=refreshToken, MC_REFRESH=accessToken
* @param {*} authMode The auth mode.
* @returns An object with all auth data. AccessToken object will be null when mode is MC_REFRESH.
*/
async function fullMicrosoftAuthFlow(entryCode, authMode) {
    try {

        let accessTokenRaw
        let accessToken
        if(authMode !== AUTH_MODE.MC_REFRESH) {
            const accessTokenResponse = await MicrosoftAuth.getAccessToken(entryCode, authMode === AUTH_MODE.MS_REFRESH, AZURE_CLIENT_ID)
            if(accessTokenResponse.responseStatus === RestResponseStatus.ERROR) {
                return Promise.reject(microsoftErrorDisplayable(accessTokenResponse.microsoftErrorCode))
            }
            accessToken = accessTokenResponse.data
            accessTokenRaw = accessToken.access_token
        } else {
            accessTokenRaw = entryCode
        }
        
        const xblResponse = await MicrosoftAuth.getXBLToken(accessTokenRaw)
        if(xblResponse.responseStatus === RestResponseStatus.ERROR) {
            return Promise.reject(microsoftErrorDisplayable(xblResponse.microsoftErrorCode))
        }
        const xstsResonse = await MicrosoftAuth.getXSTSToken(xblResponse.data)
        if(xstsResonse.responseStatus === RestResponseStatus.ERROR) {
            return Promise.reject(microsoftErrorDisplayable(xstsResonse.microsoftErrorCode))
        }
        const mcTokenResponse = await MicrosoftAuth.getMCAccessToken(xstsResonse.data)
        if(mcTokenResponse.responseStatus === RestResponseStatus.ERROR) {
            return Promise.reject(microsoftErrorDisplayable(mcTokenResponse.microsoftErrorCode))
        }
        const mcProfileResponse = await MicrosoftAuth.getMCProfile(mcTokenResponse.data.access_token)
        if(mcProfileResponse.responseStatus === RestResponseStatus.ERROR) {
            return Promise.reject(microsoftErrorDisplayable(mcProfileResponse.microsoftErrorCode))
        }
        return {
            accessToken,
            accessTokenRaw,
            xbl: xblResponse.data,
            xsts: xstsResonse.data,
            mcToken: mcTokenResponse.data,
            mcProfile: mcProfileResponse.data
        }
    } catch(err) {
        log.error(err)
        return Promise.reject(microsoftErrorDisplayable(MicrosoftErrorCode.UNKNOWN))
    }
}

/**
* Calculate the expiry date. Advance the expiry time by 10 seconds
* to reduce the liklihood of working with an expired token.
* 
* @param {number} nowMs Current time milliseconds.
* @param {number} epiresInS Expires in (seconds)
* @returns 
*/
function calculateExpiryDate(nowMs, epiresInS) {
    return nowMs + ((epiresInS-10)*1000)
}

/**
* Add a Microsoft account. This will pass the provided auth code to Mojang's OAuth2.0 flow.
* The resultant data will be stored as an auth account in the configuration database.
* 
* @param {string} authCode The authCode obtained from microsoft.
* @returns {Promise.<Object>} Promise which resolves the resolved authenticated account object.
*/
exports.addMicrosoftAccount = async function(authCode) {

    const fullAuth = await fullMicrosoftAuthFlow(authCode, AUTH_MODE.FULL)

    // Advance expiry by 10 seconds to avoid close calls.
    const now = new Date().getTime()

    const ret = ConfigManager.addMicrosoftAuthAccount(
        fullAuth.mcProfile.id,
        fullAuth.mcToken.access_token,
        fullAuth.mcProfile.name,
        calculateExpiryDate(now, fullAuth.mcToken.expires_in),
        fullAuth.accessToken.access_token,
        fullAuth.accessToken.refresh_token,
        calculateExpiryDate(now, fullAuth.accessToken.expires_in)
    )
    ConfigManager.save()

    return ret
}

/**
* Remove a Mojang account. This will invalidate the access token associated
* with the account and then remove it from the database.
* 
* @param {string} uuid The UUID of the account to be removed.
* @returns {Promise.<void>} Promise which resolves to void when the action is complete.
*/
exports.removeMojangAccount = async function(uuid){
    try {
        const authAcc = ConfigManager.getAuthAccount(uuid)
        const response = await MojangRestAPI.invalidate(authAcc.accessToken, ConfigManager.getClientToken())
        if(response.responseStatus === RestResponseStatus.SUCCESS) {
            ConfigManager.removeAuthAccount(uuid)
            ConfigManager.save()
            return Promise.resolve()
        } else {
            log.error('Error while removing account', response.error)
            return Promise.reject(response.error)
        }
    } catch (err){
        log.error('Error while removing account', err)
        return Promise.reject(err)
    }
}

/**
* Remove a Microsoft account. It is expected that the caller will invoke the OAuth logout
* through the ipc renderer.
* 
* @param {string} uuid The UUID of the account to be removed.
* @returns {Promise.<void>} Promise which resolves to void when the action is complete.
*/
exports.removeMicrosoftAccount = async function(uuid){
    try {
        ConfigManager.removeAuthAccount(uuid)
        ConfigManager.save()
        return Promise.resolve()
    } catch (err){
        log.error('Error while removing account', err)
        return Promise.reject(err)
    }
}

/**
* Remove an unofficial account.
* 
* @param {string} uuid The UUID of the account to be removed.
* @returns {Promise.<void>} Promise which resolves to void when the action is complete.
*/
exports.removeUnofficialAccount = async function(uuid){
    try {
        const authAcc = ConfigManager.getAuthAccount(uuid)
        if(authAcc) {
            ConfigManager.removeAuthAccount(uuid)
            ConfigManager.save()
            return Promise.resolve()
        } else {
            log.error('Error while removing account, uuid not found.')
            return Promise.reject(new Error('Error while removing account, uuid not found.'))
        }
    } catch (err){
        log.error('Error while removing account', err)
        return Promise.reject(err)
    }
}

/**
* Validate the selected account with Mojang's authserver. If the account is not valid,
* we will attempt to refresh the access token and update that value. If that fails, a
* new login will be required.
* 
* @returns {Promise.<boolean>} Promise which resolves to true if the access token is valid,
* otherwise false.
*/
async function validateSelectedMojangAccount(){
    const current = ConfigManager.getSelectedAccount()
    const response = await MojangRestAPI.validate(current.accessToken, ConfigManager.getClientToken())

    if(response.responseStatus === RestResponseStatus.SUCCESS) {
        const isValid = response.data
        if(!isValid){
            const refreshResponse = await MojangRestAPI.refresh(current.accessToken, ConfigManager.getClientToken())
            if(refreshResponse.responseStatus === RestResponseStatus.SUCCESS) {
                const session = refreshResponse.data
                ConfigManager.updateMojangAuthAccount(current.uuid, session.accessToken)
                ConfigManager.save()
            } else {
                log.error('Error while validating selected profile:', refreshResponse.error)
                log.info('Account access token is invalid.')
                return false
            }
            log.info('Account access token validated.')
            return true
        } else {
            log.info('Account access token validated.')
            return true
        }
    }
    
}

/**
* Validate the selected account with Microsoft's authserver. If the account is not valid,
* we will attempt to refresh the access token and update that value. If that fails, a
* new login will be required.
* 
* @returns {Promise.<boolean>} Promise which resolves to true if the access token is valid,
* otherwise false.
*/
async function validateSelectedMicrosoftAccount() {
    const current = ConfigManager.getSelectedAccount()
    const now = new Date().getTime()
    const mcExpiresAt = new Date(current.expiresAt).getTime()
    const mcExpired = now >= mcExpiresAt

    if(!mcExpired) {
        return true
    }

    // MC token expired. Check MS token.

    const msExpiresAt = new Date(current.microsoft.expires_at).getTime()
    const msExpired = now >= msExpiresAt

    if(msExpired) {
        // MS expired, do full refresh.
        try {
            const res = await fullMicrosoftAuthFlow(current.microsoft.refresh_token, AUTH_MODE.MS_REFRESH)

            ConfigManager.updateMicrosoftAuthAccount(
                current.uuid,
                res.mcToken.access_token,
                res.accessToken.access_token,
                res.accessToken.refresh_token,
                calculateExpiryDate(now, res.accessToken.expires_in),
                calculateExpiryDate(now, res.mcToken.expires_in)
            )
            ConfigManager.save()
            return true
        } catch(e) {
            return false
        }
    } else {
        // Only MC expired, use existing MS token.
        try {
            const res = await fullMicrosoftAuthFlow(current.microsoft.access_token, AUTH_MODE.MC_REFRESH)

            ConfigManager.updateMicrosoftAuthAccount(
                current.uuid,
                res.mcToken.access_token,
                current.microsoft.access_token,
                current.microsoft.refresh_token,
                current.microsoft.expires_at,
                calculateExpiryDate(now, res.mcToken.expires_in)
            )
            ConfigManager.save()
            return true
        }
        catch(e) {
            return false
        }
    }
}

/**
 * Validate the selected auth account.
 * 
 * @returns {Promise<boolean>} Promise which resolves to true if the access token is valid,
 * otherwise false.
 */
exports.validateSelected = async () => {
    const current = ConfigManager.getSelectedAccount()

    if(current.type === 'microsoft') {
        return await validateSelectedMicrosoftAccount()
    } else if(current.type === 'mojang') {
        return await validateSelectedMojangAccount()
    } else {
        return true
    }
}