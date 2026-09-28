'use strict'
/**
 * HtmlSanitizer
 *
 * Helpers to display remote content (RSS news, release notes, distribution
 * data...) in the launcher window without letting it inject markup. This
 * window has access to Node.js: remote HTML must never reach innerHTML as is.
 *
 * Renderer only (relies on DOMParser and document).
 *
 * @module htmlsanitizer
 */

// Formatting elements kept by sanitizeHTML.
const ALLOWED_TAGS = new Set([
    'a', 'b', 'blockquote', 'br', 'button', 'code', 'div', 'em', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'hr', 'i', 'img', 'li', 'ol', 'p', 'pre', 's', 'span', 'strong', 'sub', 'sup', 'u', 'ul'
])

// Elements removed together with their content. Any other element is
// replaced by its (sanitized) children.
const DROPPED_TAGS = new Set([
    'script', 'style', 'template', 'noscript', 'iframe', 'frame', 'frameset', 'object', 'embed',
    'svg', 'math', 'form', 'input', 'textarea', 'select', 'title', 'link', 'meta', 'base'
])

// Attributes copied as is. href, src and class are validated separately.
const PLAIN_ATTRIBUTES = {
    a: ['title'],
    img: ['alt', 'title', 'width', 'height']
}

const LINK_PROTOCOLS = ['https:', 'http:', 'mailto:']
const IMAGE_PROTOCOLS = ['https:']

/**
 * Validate a URL coming from remote content.
 *
 * @param {string} value The URL to check.
 * @param {Array<string>} protocols The accepted protocols.
 * @returns {string | null} The normalized URL if it is absolute and uses one of
 * the accepted protocols, otherwise null.
 */
function toSafeUrl(value, protocols = ['https:', 'http:']) {
    try {
        const url = new URL(String(value))
        return protocols.includes(url.protocol) ? url.href : null
    } catch {
        return null
    }
}

function copyAttributes(source, target, tag) {
    for (const { name, value } of Array.from(source.attributes)) {
        if (name === 'class') {
            // Only keep the classes used by the news spoilers (bbCodeSpoilerButton...).
            const classes = value.split(/\s+/).filter(c => /^bbCode[\w-]*$/.test(c))
            if (classes.length > 0) {
                target.setAttribute('class', classes.join(' '))
            }
        } else if (tag === 'a' && name === 'href') {
            const href = toSafeUrl(value, LINK_PROTOCOLS)
            if (href != null) {
                target.setAttribute('href', href)
            }
        } else if (tag === 'img' && name === 'src') {
            const src = toSafeUrl(value, IMAGE_PROTOCOLS)
            if (src != null) {
                target.setAttribute('src', src)
            }
        } else if (PLAIN_ATTRIBUTES[tag]?.includes(name)) {
            target.setAttribute(name, value)
        }
    }
    if (tag === 'button') {
        target.setAttribute('type', 'button')
    }
}

function sanitizeNode(node) {
    if (node.nodeType === Node.TEXT_NODE) {
        return document.createTextNode(node.nodeValue)
    }
    if (node.nodeType !== Node.ELEMENT_NODE) {
        // Comments, processing instructions...
        return null
    }

    const tag = node.localName
    if (DROPPED_TAGS.has(tag)) {
        return null
    }

    const content = document.createDocumentFragment()
    for (const child of Array.from(node.childNodes)) {
        const clean = sanitizeNode(child)
        if (clean != null) {
            content.appendChild(clean)
        }
    }

    if (!ALLOWED_TAGS.has(tag)) {
        return content
    }

    const element = document.createElement(tag)
    copyAttributes(node, element, tag)
    element.appendChild(content)
    return element
}

/**
 * Parse untrusted HTML and keep only a small set of formatting elements and
 * attributes. The markup is parsed in an inert document (no script runs, no
 * resource is loaded) and rebuilt node by node, never through innerHTML.
 *
 * @param {string} html The untrusted HTML.
 * @returns {DocumentFragment} The sanitized content, ready to be appended.
 */
exports.sanitizeHTML = function(html) {
    const parsed = new DOMParser().parseFromString(String(html ?? ''), 'text/html')
    const fragment = document.createDocumentFragment()
    for (const child of Array.from(parsed.body.childNodes)) {
        const clean = sanitizeNode(child)
        if (clean != null) {
            fragment.appendChild(clean)
        }
    }
    return fragment
}

/**
 * Escape a value before interpolating it in an HTML template string
 * (element content or quoted attribute value).
 *
 * @param {*} value The value to escape.
 * @returns {string} The escaped string.
 */
exports.escapeHTML = function(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
}

exports.toSafeUrl = toSafeUrl
