/* eslint-disable no-undef */

exports.fetchServerDates = async () => {
    const DATES_URL = 'http://51.77.201.23/dates.json'

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