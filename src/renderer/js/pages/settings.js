import { icon } from '../ui/icons.js'
import { esc, $, $$, toast, confirmDialog } from '../ui/dom.js'
import { avatarHtml } from '../art/blocks.js'
import { addNickDialog, switchNick, switchAccount, elyLoginDialog, getUpdateState, openUpdateModal } from '../ui/extras.js'
import { state, set, api } from '../store.js'

export function render (root) {
  const s = state.settings
  const info = state.info
  const maxRam = Math.max(2, (info.usableRamGb || info.totalRamGb) - 1)

  root.innerHTML = `
    <div class="page-head">
      <div>
        <h1 class="page-title">Настройки</h1>
        <p class="page-sub">Всё сохраняется само.</p>
      </div>
    </div>
    <div class="settings">
      <section class="card">
        <h2 class="card-title">${icon('users', 18)}Ники</h2>
        <p class="card-sub">Ник видят другие игроки на серверах. В одиночной игре к нему привязан инвентарь в мирах, поэтому у другого ника в тех же мирах инвентарь будет свой.</p>
        <div class="list" id="st-nicks"></div>
        <div class="inline" style="margin-top:12px; gap:8px">
          <button class="btn" id="st-add-nick">${icon('user-plus', 16)}Добавить ник</button>
          <button class="btn" id="st-ely">${icon('shield-check', 16)}Войти через Ely.by</button>
        </div>
        <p class="hint" style="margin-top:10px">Ely.by — бесплатные аккаунты со скинами: свой скин увидят все на серверах с поддержкой Ely.by.</p>
      </section>

      <section class="card">
        <h2 class="card-title">${icon('memory-stick', 18)}Память для игры</h2>
        <p class="card-sub">На компьютере ${info.totalRamGb} ГБ. Обычно хватает 4 ГБ, для больших сборок модов — 6–8 ГБ. Больше половины ставить не стоит: системе тоже нужна память.</p>
        <div class="ram-value" id="st-ram-val"></div>
        <input type="range" class="range" id="st-ram" min="1" max="${maxRam}" step="1" value="${s.memoryGb}" aria-label="Память в гигабайтах">
        <div class="ram-scale"><span>1 ГБ</span><span>${maxRam} ГБ</span></div>
      </section>

      <section class="card">
        <h2 class="card-title">${icon('monitor', 18)}Окно игры</h2>
        <p class="card-sub">Размер окна при запуске и что делать с лаунчером, пока ты играешь.</p>
        <div class="set-row">
          <div class="txt"><b>Полный экран</b><span>Игра откроется сразу на весь экран</span></div>
          <label class="switch"><input type="checkbox" id="st-full" ${s.fullscreen ? 'checked' : ''}><span></span></label>
        </div>
        <div class="set-row" id="st-size-row">
          <div class="txt"><b>Размер окна</b><span>В пикселях, ширина × высота</span></div>
          <div class="inline" style="width:240px">
            <input class="input" id="st-w" type="number" min="640" max="7680" value="${s.width}" aria-label="Ширина">
            <span style="color:var(--muted)">×</span>
            <input class="input" id="st-h" type="number" min="480" max="4320" value="${s.height}" aria-label="Высота">
          </div>
        </div>
        <div class="set-row">
          <div class="txt"><b>После запуска игры</b><span id="st-after-hint"></span></div>
          <div class="seg" id="st-after">
            <button data-v="hide">Скрыть</button><button data-v="keep">Оставить</button><button data-v="close">Закрыть</button>
          </div>
        </div>
      </section>

      <section class="card">
        <h2 class="card-title">${icon('coffee', 18)}Java</h2>
        <p class="card-sub">Лаунчер сам скачивает нужную Java (Eclipse Temurin) для каждой версии игры. Свою стоит указывать, только если знаешь зачем.</p>
        <div class="set-row">
          <div class="txt"><b>Источник Java</b><span id="st-java-desc"></span></div>
          <div class="seg" id="st-java-mode"><button data-v="auto">Автоматически</button><button data-v="custom">Своя</button></div>
        </div>
        <div class="field" id="st-java-custom">
          <div class="inline">
            <input class="input" id="st-java" value="${esc(s.javaPath)}" placeholder="${info.platform === 'win32' ? 'C:\\Program Files\\Java\\jdk-21\\bin\\javaw.exe' : '/usr/lib/jvm/java-21/bin/java'}" spellcheck="false">
            <button class="btn" id="st-java-pick">${icon('folder-open', 16)}Выбрать</button>
          </div>
        </div>
        <div class="field" style="margin-top:16px">
          <label class="label" for="st-jvm">Дополнительные аргументы JVM</label>
          <textarea class="input" id="st-jvm" rows="2" placeholder="-XX:+UseG1GC" spellcheck="false">${esc(s.jvmArgs)}</textarea>
          <div class="hint">Необязательно. Через пробел. Ошибка здесь может помешать игре запуститься.</div>
        </div>
      </section>

      <section class="card">
        <h2 class="card-title">${icon('folder-open', 18)}Папка игры</h2>
        <p class="card-sub">Здесь хранятся версии, библиотеки, Java и сборки с мирами.</p>
        <div class="inline">
          <input class="input" id="st-dir" value="${esc(info.gameDir)}" readonly>
          <button class="btn" id="st-dir-open" title="Открыть">${icon('folder-open', 16)}Открыть</button>
          <button class="btn" id="st-dir-pick">Изменить</button>
        </div>
        <div class="hint warn" id="st-dir-warn" style="margin-top:8px" ${info.gameDirNonAscii ? '' : 'hidden'}>
          В пути есть русские буквы или другие не-латинские символы. Старые версии игры могут из-за этого не запуститься — лучше выбрать папку вроде C:\\AstraLauncher.
        </div>
        <div class="hint" style="margin-top:8px">При смене папки уже скачанное не переносится. Можно перенести папку вручную, а потом выбрать её здесь.
          <button class="section-link" id="st-dir-reset" style="display:inline-flex;margin:0 0 0 6px">Вернуть по умолчанию</button></div>
      </section>

      <section class="card">
        <h2 class="card-title">${icon('globe', 18)}Миры и Discord</h2>
        <p class="card-sub">Копии миров хранятся в папке сборки и занимают место на диске.</p>
        <div class="set-row">
          <div class="txt"><b>Копия миров после игры</b><span>Сохраняются только миры, которые изменились</span></div>
          <label class="switch"><input type="checkbox" id="st-autobackup" ${s.autoBackup ? 'checked' : ''}><span></span></label>
        </div>
        <div class="set-row">
          <div class="txt"><b>Сколько автокопий хранить</b><span>Для каждого мира. Копии, сделанные вручную, не удаляются</span></div>
          <select class="input" id="st-keep" style="width:120px">${[3, 5, 10, 20].map(n => `<option value="${n}" ${s.keepBackups === n ? 'selected' : ''}>${n}</option>`).join('')}</select>
        </div>
        <div class="set-row">
          <div class="txt"><b>Статус в Discord</b><span>Друзья увидят «Minecraft 1.21 · В игре». Работает, если открыт Discord</span></div>
          <label class="switch"><input type="checkbox" id="st-discord" ${s.discordStatus ? 'checked' : ''}><span></span></label>
        </div>
      </section>

      <section class="card">
        <h2 class="card-title">${icon('circle-arrow-up', 18)}Обновления</h2>
        <p class="card-sub" id="st-upd-text">Версия ${esc(info.version)}.</p>
        <div class="set-row">
          <div class="txt"><b>Проверять при запуске</b><span>Лаунчер спросит, прежде чем обновиться</span></div>
          <label class="switch"><input type="checkbox" id="st-autoupd" ${s.autoUpdate ? 'checked' : ''}><span></span></label>
        </div>
        <button class="btn" id="st-check-upd">${icon('refresh-cw', 16)}Проверить сейчас</button>
      </section>

      <section class="card">
        <h2 class="card-title">${icon('info', 18)}О лаунчере</h2>
        <p class="card-sub" style="margin:0">AstraLauncher ${esc(info.version)}. Неофициальный лаунчер, не связан с Mojang и Microsoft. Каталог модов — Modrinth, загрузчик модов — Fabric, Java — Eclipse Temurin.</p>
      </section>
    </div>`

  async function save (patch, msg = 'Сохранено') {
    try {
      const settings = await api.settings.set(patch)
      set({ settings })
      if (msg) toast(msg)
      return true
    } catch (e) {
      toast(e.message, 'err')
      return false
    }
  }

  // Ники
  const paintNicks = () => {
    const cur = state.settings
    const nicks = cur.nicknames.length ? cur.nicknames : [cur.nickname].filter(Boolean)
    const nickRows = nicks.map(n => { const on = !cur.account && n === cur.nickname; return `
      <div class="row ${on ? 'selected' : ''}">
        <span class="avatar sm">${avatarHtml(n)}</span>
        <div class="row-main"><div class="row-title">${esc(n)} ${on ? '<span class="chip accent">Сейчас</span>' : ''}</div></div>
        <div class="row-actions">
          ${on ? '' : `<button class="btn sm outline-accent" data-use="${esc(n)}">Выбрать</button>`}
          ${nicks.length > 1 ? `<button class="btn sm btn-icon danger" data-del-nick="${esc(n)}" title="Убрать ник">${icon('trash-2', 15)}</button>` : ''}
        </div>
      </div>` })
    const accRows = (state.accounts || []).map(a => { const on = cur.account === a.id; return `
      <div class="row ${on ? 'selected' : ''}">
        <span class="avatar sm">${avatarHtml(a.name, true)}</span>
        <div class="row-main"><div class="row-title">${esc(a.name)} <span class="chip">Ely.by</span> ${on ? '<span class="chip accent">Сейчас</span>' : ''}</div><div class="row-sub">${esc(a.login || '')}</div></div>
        <div class="row-actions">
          ${on ? '' : `<button class="btn sm outline-accent" data-use-acc="${esc(a.id)}">Выбрать</button>`}
          <button class="btn sm ghost" data-logout="${esc(a.id)}">Выйти</button>
        </div>
      </div>` })
    $('#st-nicks', root).innerHTML = nickRows.join('') + accRows.join('')
    $('#st-add-nick', root).hidden = nicks.length >= 10
  }
  $('#st-nicks', root).addEventListener('click', async e => {
    const ua = e.target.closest('[data-use-acc]')
    if (ua) { await switchAccount(ua.dataset.useAcc); paintNicks(); return }
    const lo = e.target.closest('[data-logout]')
    if (lo) {
      const acc = (state.accounts || []).find(a => a.id === lo.dataset.logout)
      const ok = await confirmDialog({ title: `Выйти из ${acc ? acc.name : 'аккаунта'}?`, text: 'Аккаунт пропадёт из лаунчера. Миры и прогресс останутся — войди снова, и всё вернётся.', ok: 'Выйти' })
      if (!ok) return
      try {
        const settings = await api.accounts.logout(lo.dataset.logout)
        set({ settings })
        const { refreshAccounts } = await import('../store.js')
        await refreshAccounts()
        paintNicks()
        toast('Вышел из аккаунта Ely.by')
      } catch (err) { toast(err.message, 'err') }
      return
    }
    const use = e.target.closest('[data-use]')
    if (use) { await switchNick(use.dataset.use); paintNicks(); return }
    const del = e.target.closest('[data-del-nick]')
    if (del) {
      const n = del.dataset.delNick
      const ok = await confirmDialog({ title: `Убрать ник ${n}?`, text: 'Ник пропадёт из списка. Миры и прогресс останутся — если добавить его снова, всё вернётся.', ok: 'Убрать' })
      if (!ok) return
      const rest = state.settings.nicknames.filter(x => x !== n)
      const patch = { nicknames: rest }
      if (n === state.settings.nickname) patch.nickname = rest[0]
      if (await save(patch, 'Ник убран')) paintNicks()
    }
  })
  $('#st-add-nick', root).addEventListener('click', async () => {
    if (await addNickDialog()) paintNicks()
  })
  $('#st-ely', root).addEventListener('click', async () => {
    if (await elyLoginDialog()) paintNicks()
  })
  paintNicks()

  // Миры, Discord, обновления
  $('#st-autobackup', root).addEventListener('change', e => save({ autoBackup: e.target.checked }))
  $('#st-keep', root).addEventListener('change', e => save({ keepBackups: Number(e.target.value) }))
  $('#st-discord', root).addEventListener('change', e => save({ discordStatus: e.target.checked }))
  $('#st-autoupd', root).addEventListener('change', e => save({ autoUpdate: e.target.checked }))
  const paintUpd = st => {
    const t = $('#st-upd-text', root)
    if (!t) return
    const v = `Версия ${info.version}.`
    t.textContent = st.status === 'checking' ? `${v} Проверяю…`
      : st.status === 'none' ? `${v} Это последняя версия.`
        : st.status === 'available' ? `${v} Доступна ${st.version}.`
          : st.status === 'downloading' ? `${v} Скачиваю ${st.version}: ${st.percent || 0}%`
            : st.status === 'ready' ? `${v} Версия ${st.version} скачана — перезапусти лаунчер.`
              : st.status === 'error' ? `${v} Не удалось проверить: ${st.error}` : v
  }
  paintUpd(getUpdateState())
  const onUpd = e => paintUpd(e.detail)
  window.addEventListener('astra:update', onUpd)
  $('#st-check-upd', root).addEventListener('click', async () => {
    const st = await api.update.check().catch(e => ({ status: 'error', error: e.message }))
    if (st.status === 'available') openUpdateModal()
  })

  // Память
  const ram = $('#st-ram', root)
  const paintRam = () => {
    const v = Number(ram.value)
    $('#st-ram-val', root).innerHTML = `${v}<small>ГБ</small>`
    ram.style.setProperty('--fill', ((v - 1) / Math.max(1, maxRam - 1)) * 100 + '%')
  }
  ram.addEventListener('input', paintRam)
  ram.addEventListener('change', () => save({ memoryGb: Number(ram.value) }, `Игре выделено ${ram.value} ГБ`))
  paintRam()

  // Окно
  const full = $('#st-full', root)
  const paintSize = () => { $('#st-size-row', root).style.opacity = full.checked ? '.45' : '1'; $$('#st-size-row input', root).forEach(i => { i.disabled = full.checked }) }
  full.addEventListener('change', () => { paintSize(); save({ fullscreen: full.checked }) })
  paintSize()
  ;['#st-w', '#st-h'].forEach(id => $(id, root).addEventListener('change', async () => {
    await save({ width: Number($('#st-w', root).value), height: Number($('#st-h', root).value) })
    // Лаунчер мог поправить значение (например, 100 → 640) — показываем, что сохранилось.
    $('#st-w', root).value = state.settings.width
    $('#st-h', root).value = state.settings.height
  }))
  const after = $('#st-after', root)
  const AFTER_HINT = {
    hide: 'Лаунчер спрячется и вернётся, когда игра закроется',
    keep: 'Лаунчер останется открытым рядом с игрой',
    close: 'Лаунчер закроется, игра продолжит работать'
  }
  const paintAfter = () => {
    $$('button', after).forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === state.settings.afterLaunch)))
    $('#st-after-hint', root).textContent = AFTER_HINT[state.settings.afterLaunch] || ''
  }
  after.addEventListener('click', async e => {
    const b = e.target.closest('[data-v]')
    if (b && await save({ afterLaunch: b.dataset.v })) paintAfter()
  })
  paintAfter()

  // Java
  let javaMode = s.javaPath ? 'custom' : 'auto'
  const paintJava = () => {
    $$('#st-java-mode button', root).forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === javaMode)))
    $('#st-java-custom', root).hidden = javaMode !== 'custom'
    $('#st-java-desc', root).textContent = javaMode === 'auto' ? 'Подходящая версия скачается при первом запуске' : 'Используется указанный файл'
  }
  $('#st-java-mode', root).addEventListener('click', e => {
    const b = e.target.closest('[data-v]')
    if (!b) return
    javaMode = b.dataset.v
    paintJava()
    if (javaMode === 'auto' && state.settings.javaPath) save({ javaPath: '' }, 'Java будет выбираться автоматически')
  })
  $('#st-java', root).addEventListener('change', e => save({ javaPath: e.target.value }))
  $('#st-java-pick', root).addEventListener('click', async () => {
    const f = await api.dialog.pickJava()
    if (f) { $('#st-java', root).value = f; save({ javaPath: f }) }
  })
  $('#st-jvm', root).addEventListener('change', e => save({ jvmArgs: e.target.value }))
  paintJava()

  // Папка
  async function afterDirChange () {
    const fresh = await api.info()
    set({ info: fresh })
    $('#st-dir', root).value = fresh.gameDir
    $('#st-dir-warn', root).hidden = !fresh.gameDirNonAscii
    const { refreshVersions } = await import('../store.js')
    refreshVersions()
  }
  $('#st-dir-open', root).onclick = () => api.shell.openFolder('root').catch(e => toast(e.message, 'err'))
  $('#st-dir-pick', root).onclick = async () => {
    const d = await api.dialog.pickFolder()
    if (d && await save({ gameDir: d }, 'Папка игры изменена')) afterDirChange()
  }
  $('#st-dir-reset', root).onclick = async () => {
    if (await save({ gameDir: '' }, 'Папка по умолчанию')) afterDirChange()
  }
  return () => window.removeEventListener('astra:update', onUpd)
}
