// Собирает src/renderer/js/ui/icons.js из lucide-static (иконки встраиваются, чтобы работать без интернета).
const fs = require('fs')
const path = require('path')
const dir = path.join(__dirname, '..', 'node_modules', 'lucide-static', 'icons')
const names = ['house', 'gamepad-2', 'puzzle', 'layers', 'camera', 'settings', 'play', 'chevron-down', 'chevron-right', 'chevron-left', 'check', 'download', 'trash-2', 'folder-open', 'search', 'x', 'minus', 'square', 'copy', 'terminal', 'heart', 'zap', 'external-link', 'loader-circle', 'triangle-alert', 'image', 'info', 'refresh-cw', 'coffee', 'monitor', 'memory-stick', 'user', 'square-stack', 'sparkles', 'circle-stop', 'arrow-down-wide-narrow', 'package', 'clock', 'rocket',
  'globe', 'archive', 'archive-restore', 'history', 'server', 'wifi', 'wifi-off', 'users', 'user-plus', 'bug', 'circle-arrow-up', 'hourglass', 'sparkle', 'shield-check', 'plus', 'pencil', 'gauge', 'cpu', 'sun', 'package-plus', 'trophy', 'timer',
  'share-2', 'file-input', 'hard-drive', 'undo-2', 'folder-input', 'feather', 'shield-alert', 'circle-check', 'keyboard', 'brush-cleaning', 'link']
const out = {}
for (const n of names) {
  let s = fs.readFileSync(path.join(dir, n + '.svg'), 'utf8')
  s = s.replace(/<!--.*?-->/s, '').replace(/\n\s*/g, ' ').replace(/class="[^"]*"/, '').replace(/width="24"\s+height="24"\s*/, '').trim()
  out[n] = s.replace(/^<svg\s+/, '<svg aria-hidden="true" focusable="false" ')
}
const js = '// Иконки Lucide (ISC License), встроены, чтобы работать без интернета.\n// Собирается скриптом dev/make-icon-module.js.\nconst ICONS = ' +
  JSON.stringify(out, null, 0).replace(/","/g, '",\n  "') +
  '\n\nexport function icon (name, size = 20) {\n  const svg = ICONS[name]\n  if (!svg) return \'\'\n  return svg.replace(\'<svg \', `<svg width="${size}" height="${size}" `)\n}\n'
fs.writeFileSync(path.join(__dirname, '..', 'src', 'renderer', 'js', 'ui', 'icons.js'), js)
console.log(Object.keys(out).length + ' icons')
