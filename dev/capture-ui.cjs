'use strict'
// Real Electron screenshots using Astra's offline demo mode (not a painted mockup).
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { _electron } = require('playwright-core')

async function main () {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'astra-ui-preview-'))
  const output = path.join(process.cwd(), 'docs', 'screenshots')
  fs.mkdirSync(output, { recursive: true })
  fs.writeFileSync(path.join(work, 'settings.json'), JSON.stringify({
    nickname: 'AstraPlayer',
    nicknames: ['AstraPlayer'],
    autoUpdate: false,
    profile: { version: '1.21.10', loader: 'fabric' }
  }))

  let application
  try {
    application = await _electron.launch({
      executablePath: require('electron'),
      cwd: process.cwd(),
      args: ['.', '--no-sandbox', '--disable-gpu'],
      env: { ...process.env, ASTRA_MOCK: '1', ASTRA_USER_DATA: work }
    })
    const page = await application.firstWindow()
    page.setDefaultTimeout(30000)
    await page.waitForSelector('.hero-title', { timeout: 60000 })
    await page.waitForFunction(() => document.querySelectorAll('#nav .nav-item').length === 6)
    await page.waitForTimeout(2500) // complete first paint and mock catalog load
    const title = await page.locator('.hero-title').textContent()
    if (!title || !title.trim()) throw new Error('Main hero did not render')
    await page.screenshot({
      path: path.join(output, 'astra-home-current.png'),
      animations: 'disabled'
    })
    console.log('Home screenshot:', title.trim())

    await page.locator('[data-route="settings"]').click()
    await page.waitForSelector('#st-shortcuts')
    await page.waitForTimeout(450)
    await page.screenshot({
      path: path.join(output, 'astra-settings-current.png'),
      animations: 'disabled',
      fullPage: true
    })
    console.log('Settings screenshot and shortcut configuration rendered')
  } finally {
    if (application) await application.close().catch(() => {})
    fs.rmSync(work, { recursive: true, force: true })
  }
}

main().catch(err => { console.error(err); process.exitCode = 1 })
