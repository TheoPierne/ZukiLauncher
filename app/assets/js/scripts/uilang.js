/**
 * Apply the translated texts of the views. Loaded at the end of app.ejs, once
 * every view is in the DOM. Kept out of app.ejs so that the CSP does not need
 * to allow inline scripts.
 */
for (let key of Object.keys(Lang.query('html'))) {
    document.getElementById(key).innerHTML = Lang.query(`html.${key}`)
}
