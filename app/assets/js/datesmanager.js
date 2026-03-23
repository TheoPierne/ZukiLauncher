'use strict'

exports.fetchServerDates = async () => {
    const DATES_URL = 'https://zukipalace.theopierne.fr/dates.json'

    try {
        if (sessionStorage.getItem('nextServerData')) {
            return JSON.parse(sessionStorage.getItem('nextServerData')) || {}
        }

        const response = await fetch(DATES_URL, { cache: 'no-store' })
        if (!response.ok) {
            throw new Error(`Erreur HTTP ${response.status} : ${response.statusText}`)
        }

        const data = await response.json()

        if (sessionStorage.getItem('nextServerData') !== JSON.stringify(data)) {
            sessionStorage.setItem('nextServerData', JSON.stringify(data))
        }

        return data
    } catch (err) {
        console.error('Error while trying to fetch server dates', err)
    }
}

exports.fetchAuthorizedAccounts = async () => {
    const AUTHORIZED_URL = 'https://zukipalace.theopierne.fr/authorized_access.json'

    try {
        if (sessionStorage.getItem('authorizeToBypassWaitingScreen')) {
            return JSON.parse(sessionStorage.getItem('authorizeToBypassWaitingScreen')) || {}
        }

        const response = await fetch(AUTHORIZED_URL, { cache: 'no-store' })
        if (!response.ok) {
            throw new Error(`Erreur HTTP ${response.status} : ${response.statusText}`)
        }

        const data = await response.json()

        if (sessionStorage.getItem('authorizeToBypassWaitingScreen') !== JSON.stringify(data)) {
            sessionStorage.setItem('authorizeToBypassWaitingScreen', JSON.stringify(data))
        }

        return data
    } catch (err) {
        console.error('Error while trying to fetch server dates', err)
    }
}