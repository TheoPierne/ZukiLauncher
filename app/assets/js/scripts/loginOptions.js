const loginOptionsCancelContainer = document.getElementById('loginOptionCancelContainer')
const loginOptionMicrosoft = document.getElementById('loginOptionMicrosoft')
const loginOptionMojang = document.getElementById('loginOptionMojang')
const loginOptionFakeAccount = document.getElementById('loginOptionFakeAccount')
const loginOptionsCancelButton = document.getElementById('loginOptionCancelButton')

let loginOptionsCancellable = false
let isOfficialLogin = true

let loginOptionsViewOnLoginSuccess
let loginOptionsViewOnLoginCancel
let loginOptionsViewOnCancel
let loginOptionsViewCancelHandler

function loginOptionsCancelEnabled(val){
    if(val){
        $(loginOptionsCancelContainer).show()
    } else {
        $(loginOptionsCancelContainer).hide()
    }
}

loginOptionMicrosoft.onclick = (e) => {
    switchView(getCurrentView(), VIEWS.waiting, 500, 500, () => {
        ipcRenderer.send(
            MSFT_OPCODE.OPEN_LOGIN,
            loginOptionsViewOnLoginSuccess,
            loginOptionsViewOnLoginCancel
        )
    })
}

loginOptionMojang.onclick = () => {
    switchView(getCurrentView(), VIEWS.login, 500, 500, () => {
        loginFieldPasswordContainer && (loginFieldPasswordContainer.style.display = '')
        loginEmailError && (loginEmailError.style.opacity = 0)
        loginPasswordError && (loginPasswordError.style.opacity = 0)
        loginViewOnSuccess = loginOptionsViewOnLoginSuccess
        loginViewOnCancel = loginOptionsViewOnLoginCancel
        loginCancelEnabled(true)
        isOfficialLogin = true
    })
}

loginOptionFakeAccount.onclick = () => {
    switchView(getCurrentView(), VIEWS.login, 500, 500, () => {
        loginUsername && (loginUsername.placeholder = Lang.queryJS('login.placeholder.unofficialAccount'))
        loginSubheader && (loginSubheader.innerText = Lang.queryJS('login.unofficialAccount'))
        loginDisclaimer && (loginDisclaimer.style.display = 'none')
        loginOptions && (loginOptions.style.display = 'none')
        loginFieldPasswordContainer && (loginFieldPasswordContainer.style.display = 'none')
        loginEmailError && (loginEmailError.style.opacity = 0)
        loginViewOnSuccess = loginOptionsViewOnLoginSuccess
        loginViewOnCancel = loginOptionsViewOnLoginCancel
        loginCancelEnabled(true)
        isOfficialLogin = false
    })
}

loginOptionsCancelButton.onclick = () => {
    switchView(getCurrentView(), loginOptionsViewOnCancel, 500, 500, () => {
        // Clear login values (Mojang login)
        // No cleanup needed for Microsoft.
        loginUsername.value = ''
        loginPassword.value = ''
        if(loginOptionsViewCancelHandler != null){
            loginOptionsViewCancelHandler()
            loginOptionsViewCancelHandler = null
        }
    })
}