// Окна новых функций 0.2.0: проверка перед запуском, игра с другом,
// поделиться сборкой, перенос из TLauncher, место на диске.
import { icon } from './icons.js'
import { esc, $, $$, modal, toast, fmtSize, plural, confirmDialog } from './dom.js'
import { state, set, api, profile, profileLabel, versionInfo, refreshPacks, selectProfile } from '../store.js'
import { go } from '../router.js'

const SPIN = s => icon('loader-circle', s).replace('<svg ', '<svg class="spin" ')

export function fmtGb (b) {
  if (b == null) return '—'
  if (b >= 1024 ** 3) return (b / 1024 ** 3).toFixed(1).replace('.', ',') + ' ГБ'
  return fmtSize(b)
}

// ---------- запуск с проверкой ----------
// Перед запуском проверяем компьютер и моды. Если есть о чём предупредить — окно
// с кнопками «исправить»; «Играть всё равно» запускает как есть.
export async function launchChecked (p = profile(), opts = {}, onChecked = () => {}) {
  let warnings = []
  try { warnings = await api.game.precheck(p) } catch { warnings = [] }
  onChecked()
  if (warnings.length) {
    const go2 = await precheckDialog(p, warnings)
    if (!go2) return false
  }
  try {
    await api.game.launch(p, opts)
    return true
  } catch { return false } // ошибку показывает обработчик статуса
}

function precheckDialog (p, warnings) {
  return new Promise(resolve => {
    let answered = false
    const left = new Set(warnings.map(w => w.id))
    const m = modal(`
      <div class="crash-head">${icon('shield-alert', 28)}<div><h2>Перед запуском</h2><p>Лаунчер нашёл, что может помешать игре.</p></div></div>
      <div class="checks">${warnings.map(w => `
        <section class="check ${w.level === 'error' ? 'err' : ''}" data-w="${esc(w.id)}">
          <div class="check-title">${icon(w.level === 'error' ? 'triangle-alert' : 'info', 16)}<b>${esc(w.title)}</b></div>
          <p>${esc(w.text)}</p>
          <div class="check-actions">
            ${(w.actions || []).map((a, i) => `<button class="btn sm" data-act="${i}">${esc(a.label)}</button>`).join('')}
            ${w.level === 'error' ? '' : `<button class="section-link" data-mute>Больше не предупреждать</button>`}
          </div>
        </section>`).join('')}
      </div>
      <div class="modal-actions">
        <button class="btn ghost" data-close>Отмена</button>
        <button class="btn primary" id="pc-go">${icon('play', 16)}Играть всё равно</button>
      </div>`, { onClose: () => { if (!answered) resolve(false) } })
    const goBtn = $('#pc-go', m.el)
    const resolved = id => {
      left.delete(id)
      const box = $(`[data-w="${CSS.escape(id)}"]`, m.el)
      if (box) { box.classList.add('done'); $('.check-actions', box).innerHTML = `<span class="ok-line">${icon('circle-check', 15)}Готово</span>` }
      if (!left.size) goBtn.innerHTML = `${icon('play', 16)}Играть`
    }
    goBtn.onclick = () => { answered = true; m.close(); resolve(true) }
    m.el.addEventListener('click', async e => {
      const box = e.target.closest('[data-w]')
      if (!box) return
      const w = warnings.find(x => x.id === box.dataset.w)
      if (e.target.closest('[data-mute]')) {
        try { set({ settings: await api.muteWarning(w.id) }) } catch {}
        resolved(w.id)
        return
      }
      const b = e.target.closest('[data-act]')
      if (!b) return
      const a = w.actions[Number(b.dataset.act)]
      if (a.type === 'cleanup' || a.type === 'settings') {
        answered = true; m.close(); resolve(false)
        go('settings')
        if (a.type === 'cleanup') setTimeout(storageDialog, 300)
        return
      }
      b.disabled = true
      b.innerHTML = `${SPIN(14)}${esc(a.label)}`
      try {
        if (a.type === 'disable') await api.content.toggle({ profile: p, file: a.file })
        if (a.type === 'install') await api.content.install({ projectId: a.projectId, profile: p, type: 'mod' })
        resolved(w.id)
        window.dispatchEvent(new CustomEvent('astra:installed'))
      } catch (err) {
        toast(err.message, 'err', 6000)
        b.disabled = false
        b.textContent = a.label
      }
    })
  })
}

// ---------- игра с другом ----------
export function friendDialog (world = null, p = profile()) {
  const v = versionInfo(p.version)
  if (v && !v.fabric) { toast(`Для ${p.version} игра с другом недоступна — выбери версию 1.18 или новее`, 'err', 6000); return }
  const modded = p.loader === 'fabric'
  const m = modal(`
    <div class="crash-head">${icon('users', 28)}<div><h2>Играть с другом</h2><p>Без сервера и без настройки роутера. Работает через мод e4mc — лаунчер поставит его сам.</p></div></div>
    <ol class="steps">
      <li>${world ? `Лаунчер запустит ${esc(profileLabel(p))} и сразу откроет мир «${esc(world)}» (в старых версиях — выбери мир в меню).` : `Лаунчер запустит ${esc(profileLabel(p))}. Зайди в мир, в который хочешь позвать друга.`}</li>
      <li>В игре нажми <b>Esc → «Открыть для сети» → «Открыть мир в сети»</b>.</li>
      <li>В чате появится адрес. Лаунчер тоже его покажет — скопируй и отправь другу.</li>
      <li>Друг заходит в <b>Сетевая игра → Прямое подключение</b> и вставляет адрес.</li>
    </ol>
    <p class="hint">Другу нужен Minecraft ${esc(p.version)}. Ставить мод ему не нужно.${modded ? ' Если в сборке есть моды с новыми блоками или мобами, другу нужна такая же сборка — отправь её кнопкой «Поделиться сборкой» в разделе «Моды».' : ''} Мир открыт, пока ты в игре.</p>
    <div class="modal-actions">
      <button class="btn ghost" data-close>Отмена</button>
      <button class="btn primary" id="fr-go">${icon('play', 16)}Запустить</button>
    </div>`)
  $('#fr-go', m.el).onclick = async () => {
    if (state.game.state !== 'idle') { toast('Игра уже запущена', 'err'); return }
    m.close()
    go('home')
    launchChecked(p, { friend: true, world })
  }
}

export async function copyFriendAddress () {
  const a = state.game.friendAddress
  if (!a) return
  try { await navigator.clipboard.writeText(a); toast(`Адрес ${a} скопирован — отправь его другу`) } catch { toast('Не удалось скопировать', 'err') }
}

// ---------- поделиться сборкой ----------
export function shareDialog (p = profile(), defaultName = '') {
  const m = modal(`
    <div class="crash-head">${icon('share-2', 28)}<div><h2>Поделиться сборкой</h2><p>Версия игры, моды, ресурспаки, шейдеры и настройки модов сохранятся в один файл .mrpack. Отправь его другу — он откроет файл в AstraLauncher (или в другом лаунчере с поддержкой Modrinth) и получит всё то же самое.</p></div></div>
    <div class="field"><label class="label" for="sh-name">Название</label>
      <input class="input" id="sh-name" maxlength="60" value="${esc(defaultName || `Сборка ${state.settings.nickname || ''} ${p.version}`.replace(/\s+/g, ' ').trim())}" autofocus></div>
    <p class="hint" style="margin-top:10px">Моды с Modrinth в файл не кладутся — только ссылки, поэтому он маленький. Миры и твои настройки управления не передаются.</p>
    <div class="modal-actions">
      <button class="btn ghost" data-close>Отмена</button>
      <button class="btn primary" id="sh-go">${icon('download', 16)}Сохранить файл</button>
    </div>`)
  const btn = $('#sh-go', m.el)
  btn.onclick = async () => {
    btn.disabled = true
    btn.innerHTML = `${SPIN(16)}Собираю…`
    try {
      const res = await api.packs.exportPack(p, $('#sh-name', m.el).value.trim())
      if (!res) { btn.disabled = false; btn.innerHTML = `${icon('download', 16)}Сохранить файл`; return }
      m.close()
      toast(`Сборка сохранена (${fmtSize(res.size)}): ${res.fromModrinth} ${plural(res.fromModrinth, 'файл', 'файла', 'файлов')} по ссылке${res.inside ? `, ${res.inside} внутри` : ''}`, 'ok', 6000)
      if (res.skipped.length) toast(`Не вошли (слишком большие): ${res.skipped.join(', ')}`, 'err', 7000)
    } catch (e) {
      toast(e.message, 'err', 6000)
      btn.disabled = false
      btn.innerHTML = `${icon('download', 16)}Сохранить файл`
    }
  }
}

// Открыть файл сборки (из диалога или перетаскиванием).
export async function importPack (file = null) {
  if (state.game.state !== 'idle') { toast('Сначала закрой игру', 'err'); return }
  toast('Открываю сборку…', 'info')
  try {
    const res = await api.packs.importFile(file)
    if (!res) return
    await refreshPacks()
    await selectProfile(res.profile)
    toast(`Сборка «${res.name}» установлена и выбрана. Нажми «Играть»!`, 'ok', 6000)
  } catch (e) { toast(e.message, 'err', 7000) }
}

// ---------- перенос из TLauncher ----------
export async function migrateDialog ({ first = false, dir = null } = {}) {
  let info = null
  try { info = await api.migrate.detect(dir) } catch {}
  if (!info) {
    if (first) return
    const pick = await confirmDialog({ title: 'Папка .minecraft не найдена', text: 'Лаунчер ищет её в обычном месте (%APPDATA%\\.minecraft). Если TLauncher хранит игру в другой папке — выбери её.', ok: 'Выбрать папку', cancel: 'Отмена' })
    if (pick) {
      const d = await api.dialog.pickFolder()
      if (d) return migrateDialog({ dir: d })
    }
    return
  }
  // Версия для переноса: в какой чаще всего играли (по мирам), иначе выбранная.
  const vers = state.versions ? state.versions.versions : []
  const known = id => vers.find(v => v.id === id)
  const counts = {}
  for (const w of info.worlds) if (w.version && known(w.version)) counts[w.version] = (counts[w.version] || 0) + 1
  const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]
  let target = best ? best[0] : profile().version
  const options = [...new Set([target, profile().version, ...Object.keys(counts), ...vers.filter(v => v.type === 'release').slice(0, 30).map(v => v.id)])].filter(Boolean)
  const newer = (a, b) => { const x = known(a); const y = known(b); return x && y && x.releaseTime > y.releaseTime }

  const m = modal(`
    <div class="crash-head">${icon('folder-input', 28)}<div><h2>Перенос из ${esc(info.from === 'TLauncher' ? 'TLauncher' : 'старого лаунчера')}</h2><p>Нашёл папку <b>${esc(info.dir)}</b>. Файлы скопируются — в старой папке ничего не изменится.</p></div></div>
    <div class="field"><label class="label" for="mg-target">В какую версию перенести</label>
      <select class="input" id="mg-target">${options.map(id => `<option value="${esc(id)}" ${id === target ? 'selected' : ''}>${esc(id)}${counts[id] ? ` — миров из неё: ${counts[id]}` : ''}</option>`).join('')}</select></div>
    ${info.worlds.length ? `<div class="label" style="margin:14px 0 6px">Миры</div><div class="mg-worlds" id="mg-worlds"></div>` : ''}
    <div class="label" style="margin:14px 0 6px">Ещё</div>
    <div class="mg-extra">
      ${info.screenshots ? `<label><input type="checkbox" data-x="screenshots" checked> Скриншоты (${info.screenshots})</label>` : ''}
      ${info.resourcepacks ? `<label><input type="checkbox" data-x="resourcepacks" checked> Ресурспаки (${info.resourcepacks})</label>` : ''}
      ${info.shaderpacks ? `<label><input type="checkbox" data-x="shaderpacks" checked> Шейдеры (${info.shaderpacks})</label>` : ''}
      ${info.servers ? '<label><input type="checkbox" data-x="servers" checked> Список серверов</label>' : ''}
      ${info.options ? '<label><input type="checkbox" data-x="options" checked> Управление, мышь и звук (станут общими для всех версий)</label>' : ''}
    </div>
    <div class="upd-progress" id="mg-prog" hidden><div class="bar"><i></i></div><span></span></div>
    <div class="modal-actions">
      <button class="btn ghost" data-close>${first ? 'Не сейчас' : 'Отмена'}</button>
      <button class="btn primary" id="mg-go">${icon('folder-input', 16)}Перенести</button>
    </div>`, { onClose: () => { if (first) api.settings.set({ migrationOffered: true }).then(s => set({ settings: s })).catch(() => {}) } })

  const paintWorlds = () => {
    const box = $('#mg-worlds', m.el)
    if (!box) return
    const checked = new Set($$('[data-world]:checked', box).map(x => x.dataset.world))
    const first2 = !box.childElementCount
    box.innerHTML = info.worlds.map(w => {
      const warn = w.version && newer(w.version, target)
      return `<label class="mg-world">
        <input type="checkbox" data-world="${esc(w.name)}" ${(first2 && !warn) || (!first2 && checked.has(w.name)) ? 'checked' : ''}>
        <span class="row-main"><b>${esc(w.levelName || w.name)}</b><small>${w.version ? 'Minecraft ' + esc(w.version) : 'старая версия'} · ${fmtGb(w.size)}</small></span>
        ${warn ? `<span class="chip accent" title="Мир сохранён в более новой версии и в ${esc(target)} может не открыться. Перенеси его отдельно, выбрав его версию">новее ${esc(target)}</span>` : ''}
      </label>`
    }).join('')
  }
  paintWorlds()
  $('#mg-target', m.el).addEventListener('change', e => { target = e.target.value; paintWorlds() })

  const btn = $('#mg-go', m.el)
  btn.onclick = async () => {
    const worlds = $$('[data-world]:checked', m.el).map(x => x.dataset.world)
    const what = { worlds }
    $$('[data-x]', m.el).forEach(x => { what[x.dataset.x] = x.checked })
    const tp = { version: target, loader: 'vanilla' }
    btn.disabled = true
    btn.innerHTML = `${SPIN(16)}Переношу…`
    const prog = $('#mg-prog', m.el)
    prog.hidden = false
    const onTask = e => {
      const st = e.detail
      if (st.key !== 'migrate' || st.done) return
      prog.querySelector('i').style.width = Math.round((st.current || 0) / Math.max(1, st.total || 1) * 100) + '%'
      prog.querySelector('span').textContent = st.stage || ''
    }
    window.addEventListener('astra:task', onTask)
    try {
      const res = await api.migrate.run({ dir: info.dir, target: tp, what })
      await selectProfile(tp)
      m.close()
      const parts = []
      if (res.worlds.length) parts.push(`миров: ${res.worlds.length}`)
      if (res.screenshots) parts.push(`скриншотов: ${res.screenshots}`)
      if (res.resourcepacks) parts.push(`ресурспаков: ${res.resourcepacks}`)
      if (res.shaderpacks) parts.push(`шейдеров: ${res.shaderpacks}`)
      if (res.servers) parts.push('список серверов')
      if (res.options) parts.push('управление')
      toast(parts.length ? `Перенесено в ${target}: ${parts.join(', ')}` : 'Нечего переносить — всё уже есть', 'ok', 7000)
      if (res.skipped) toast(`Миров уже было перенесено раньше: ${res.skipped} — их не трогал`, 'info', 6000)
      if (res.shaderpacks) toast('Шейдеры работают через Fabric: включи его для этой версии в разделе «Моды»', 'info', 7000)
      window.dispatchEvent(new CustomEvent('astra:worlds-changed'))
    } catch (e) {
      toast(e.message, 'err', 7000)
      btn.disabled = false
      btn.innerHTML = `${icon('folder-input', 16)}Перенести`
    }
    window.removeEventListener('astra:task', onTask)
  }
}

// ---------- место на диске ----------
export async function storageDialog () {
  const m = modal(`
    <div class="crash-head">${icon('hard-drive', 28)}<div><h2>Место на диске</h2><p id="st-free">Считаю…</p></div></div>
    <div id="st-body"><div class="skeleton" style="height:180px"></div></div>
    <div class="modal-actions"><button class="btn ghost" data-close>Закрыть</button></div>`)
  m.el.classList.add('wide')
  const body = $('#st-body', m.el)

  async function paint () {
    let r
    try { r = await api.storage.scan() } catch (e) { body.innerHTML = `<div class="notice err">${icon('triangle-alert', 18)}<div>${esc(e.message)}</div></div>`; return }
    if (!m.el.isConnected) return
    $('#st-free', m.el).textContent = `Папка игры: ${r.gameDir}. Свободно на диске: ${fmtGb(r.free)}.`
    const j = r.junk
    const junkTotal = j.libs + j.assets + j.logs + j.temp + j.java
    const rows = (list, fn) => list.length ? list.map(fn).join('') : '<div class="hint">Пусто</div>'
    body.innerHTML = `
      <section class="st-group">
        <div class="st-head"><b>Лишние файлы</b><span>${fmtGb(junkTotal)}</span>
          <button class="btn sm primary" data-clean ${junkTotal ? '' : 'disabled'}>${icon('brush-cleaning', 15)}Очистить</button></div>
        <p class="hint">Не нужны ни одной скачанной версии. Миры и моды не трогаются, а если что-то понадобится — скачается снова.</p>
        ${r.shared ? '<p class="hint warn">Папку игры использует и другой лаунчер, поэтому библиотеки и звуки здесь не чистятся — они могут быть нужны ему.</p>' : ''}
        <div class="st-lines">
          <span>Библиотеки удалённых версий</span><b>${fmtGb(j.libs)}</b>
          <span>Звуки и текстуры удалённых версий</span><b>${fmtGb(j.assets)}</b>
          <span>Ненужная Java</span><b>${fmtGb(j.java)}</b>
          <span>Логи и отчёты о вылетах</span><b>${fmtGb(j.logs)}</b>
          <span>Временные файлы</span><b>${fmtGb(j.temp)}</b>
        </div>
      </section>
      <section class="st-group">
        <div class="st-head"><b>Файлы версий</b><span>${fmtGb(r.versions.reduce((n, x) => n + x.size, 0))}</span></div>
        <p class="hint">Сама игра. Удаление не трогает миры — версия скачается снова при запуске.</p>
        <div class="list">${rows(r.versions, v => `<div class="row sm"><div class="row-main"><div class="row-title">${esc(v.id)}</div></div><div class="row-meta"><span>${fmtGb(v.size)}</span></div><div class="row-actions"><button class="btn sm btn-icon danger" data-del-version="${esc(v.id)}" title="Удалить файлы версии">${icon('trash-2', 15)}</button></div></div>`)}</div>
      </section>
      <section class="st-group">
        <div class="st-head"><b>Сборки и миры</b><span>${fmtGb(r.instances.reduce((n, x) => n + x.size, 0))}</span></div>
        <p class="hint">Моды, миры и копии миров каждой версии. Здесь ничего не удаляется — миры удаляй в игре, копии миров — в разделе «Миры».</p>
        <div class="list">${rows(r.instances, x => `<div class="row sm"><div class="row-main"><div class="row-title">${esc(x.label)}</div><div class="row-sub">${x.worlds} ${plural(x.worlds, 'мир', 'мира', 'миров')}${x.backups ? ` · копии миров ${fmtGb(x.backups)}` : ''}</div></div><div class="row-meta"><span>${fmtGb(x.size)}</span></div></div>`)}</div>
      </section>`
  }
  body.addEventListener('click', async e => {
    if (e.target.closest('[data-clean]')) {
      const b = e.target.closest('[data-clean]')
      b.disabled = true; b.innerHTML = `${SPIN(15)}Чищу…`
      try {
        const res = await api.storage.clean()
        toast(`Освобождено ${fmtGb(res.freed)}`)
      } catch (err) { toast(err.message, 'err') }
      return paint()
    }
    const dv = e.target.closest('[data-del-version]')
    if (dv) {
      const id = dv.dataset.delVersion
      const ok = await confirmDialog({ title: `Удалить файлы ${id}?`, text: 'Миры, моды и скриншоты останутся. При следующем запуске версия скачается снова.' })
      if (!ok) return
      try { await api.versions.remove(id); toast(`Файлы ${id} удалены`) } catch (err) { toast(err.message, 'err') }
      const { refreshVersions } = await import('../store.js')
      refreshVersions()
      paint()
    }
  })
  paint()
}
