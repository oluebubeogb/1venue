/** The 1venue mark: a bold "1" standing as the wall of an outlined house. */
const VIEWBOX = '0 0 160 160';
function markPaths(color = 'currentColor', { bold = 16, thin = 5.5 } = {}) {
  return `<path d="M36 54 L62 34 L62 122" fill="none" stroke="${color}" stroke-width="${bold}" stroke-linecap="round" stroke-linejoin="round"/>`
    + `<path d="M88 36 L128 62 L128 118 L88 118 L88 98" fill="none" stroke="${color}" stroke-width="${thin}" stroke-linecap="round" stroke-linejoin="round"/>`;
}
function svg(color = 'currentColor', size) {
  const dim = size ? ` width="${size}" height="${size}"` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${VIEWBOX}"${dim} role="img" aria-label="1venue">${markPaths(color)}</svg>`;
}
module.exports = { VIEWBOX, markPaths, svg };
