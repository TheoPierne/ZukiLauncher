/**
* Script for login.ejs
*/
// Validation Regexes.
// Minecraft player names: 3 to 16 letters, digits or underscores.
const validUsername         = /^[a-zA-Z0-9_]{3,16}$/

// Login Elements
const loginCancelContainer = document.getElementById('loginCancelContainer')
const loginCancelButton = document.getElementById('loginCancelButton')
const loginEmailError = document.getElementById('loginEmailError')
const loginUsername = document.getElementById('loginUsername')
const loginPasswordError = document.getElementById('loginPasswordError')
const loginPassword = document.getElementById('loginPassword')
const loginFieldPasswordContainer = document.getElementById('loginFieldPasswordContainer')
const loginSubheader = document.getElementById('loginSubheader')
const loginOptions = document.getElementById('loginOptions')
const loginDisclaimer = document.getElementById('loginDisclaimer')
const checkmarkContainer = document.getElementById('checkmarkContainer')
const loginRememberOption = document.getElementById('loginRememberOption')
const loginButton = document.getElementById('loginButton')
const loginForm = document.getElementById('loginForm')

/**
* Show a login error.
* 
* @param {HTMLElement} element The element on which to display the error.
* @param {string} value The error text.
*/
function showError(element, value){
    element.innerHTML = value
    element.style.opacity = 1
}

/**
* Shake a login error to add emphasis.
* 
* @param {HTMLElement} element The element to shake.
*/
function shakeError(element){
    if(element.style.opacity == 1){
        element.classList.remove('shake')
        void element.offsetWidth
        element.classList.add('shake')
    }
}

/**
* Validate that the username field contains a valid player name.
*
* @param {string} value The username value.
*/
function validateUsername(value){
    if(value){
        if(!validUsername.test(value)){
            showError(loginEmailError, Lang.queryJS('login.error.invalidValue'))
            loginDisabled(true)
        } else {
            loginEmailError.style.opacity = 0
            loginDisabled(false)
        }
    } else {
        showError(loginEmailError, Lang.queryJS('login.error.requiredValue'))
        loginDisabled(true)
    }
}

// Emphasize errors with shake when focus is lost.
loginUsername.addEventListener('focusout', (e) => {
    validateUsername(e.target.value)
    shakeError(loginEmailError)
})

// Validate input.
loginUsername.addEventListener('input', (e) => {
    validateUsername(e.target.value)
})

/**
* Enable or disable the login button.
* 
* @param {boolean} v True to enable, false to disable.
*/
function loginDisabled(v){
    if(loginButton.disabled !== v){
        loginButton.disabled = v
    }
}

/**
* Enable or disable loading elements.
* 
* @param {boolean} v True to enable, false to disable.
*/
function loginLoading(v){
    if(v){
        loginButton.setAttribute('loading', v)
        loginButton.innerHTML = loginButton.innerHTML.replace(Lang.queryJS('login.login'), Lang.queryJS('login.loggingIn'))
    } else {
        loginButton.removeAttribute('loading')
        loginButton.innerHTML = loginButton.innerHTML.replace(Lang.queryJS('login.loggingIn'), Lang.queryJS('login.login'))
    }
}

/**
* Enable or disable login form.
* 
* @param {boolean} v True to enable, false to disable.
*/
function formDisabled(v){
    loginDisabled(v)
    loginCancelButton.disabled = v
    loginUsername.disabled = v
    loginPassword.disabled = v
    if(v){
        checkmarkContainer.setAttribute('disabled', v)
    } else {
        checkmarkContainer.removeAttribute('disabled')
    }
    loginRememberOption.disabled = v
}

let loginViewOnSuccess = VIEWS.landing
let loginViewOnCancel = VIEWS.settings
let loginViewCancelHandler

function loginCancelEnabled(val){
    if(val){
        $(loginCancelContainer).show()
    } else {
        $(loginCancelContainer).hide()
    }
}

loginCancelButton.onclick = (e) => {
    switchView(getCurrentView(), loginViewOnCancel, 500, 500, () => {
        loginUsername.value = ''
        loginPassword.value = ''
        loginCancelEnabled(false)
        if(loginViewCancelHandler != null){
            loginViewCancelHandler()
            loginViewCancelHandler = null
        }
    })
}

// Disable default form behavior.
loginForm.onsubmit = () => { return false }

// Bind login button behavior.
loginButton.addEventListener('click', () => {
    // Disable form.
    formDisabled(true)

    // Show loading stuff.
    loginLoading(true)

    AuthManager.addUnofficalAccount(loginUsername.value).then(value => {
        updateSelectedAccount(value)
        loginButton.innerHTML = loginButton.innerHTML.replace(Lang.queryJS('login.loggingIn'), Lang.queryJS('login.success'))
        $('.circle-loader').toggleClass('load-complete')
        $('.checkmark').toggle()
        setTimeout(() => {
            switchView(VIEWS.login, loginViewOnSuccess, 500, 500, () => {
            // Temporary workaround
                if(loginViewOnSuccess === VIEWS.settings){
                    prepareSettings()
                }
                loginViewOnSuccess = VIEWS.landing // Reset this for good measure.
                loginCancelEnabled(false) // Reset this for good measure.
                loginViewCancelHandler = null // Reset this for good measure.
                loginUsername.value = ''
                $('.circle-loader').toggleClass('load-complete')
                $('.checkmark').toggle()
                loginLoading(false)
                loginButton.innerHTML = loginButton.innerHTML.replace(Lang.queryJS('login.success'), Lang.queryJS('login.login'))
                formDisabled(false)
            })
        }, 1000)
    }).catch(displayableError => {
        loginLoading(false)

        let actualDisplayableError
        if(isDisplayableError(displayableError)) {
            msftLoginLogger.error('Error while logging in.', displayableError)
            actualDisplayableError = displayableError
        } else {
        // Uh oh.
            msftLoginLogger.error('Unhandled error during login.', displayableError)
            actualDisplayableError = {
                title: 'Erreur inconnue lors de la création du compte',
                desc: 'Une erreur inconnue s\'est produite. Veuillez consulter la console pour plus de détails.'
            }
        }

        setOverlayContent(actualDisplayableError.title, actualDisplayableError.desc, Lang.queryJS('login.tryAgain'))
        setOverlayHandler(() => {
            formDisabled(false)
            toggleOverlay(false)
        })
        toggleOverlay(true)
    })

})