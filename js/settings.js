// Kitchen MEP — Settings panel (module 16), classic script. Event-driven: renderSettings() runs
// from the header gear (openSettings, in dashboard.html); field handlers persist on change. Appearance delegates to the existing
// setTheme (dashboard) + setLangDash (i18n). Business/Operations values are stored in localStorage
// under `kmep_settings` and read elsewhere via the global kmepSetting()/kmepSettingNum() accessors:
//   targetFC → menu-view/editor FC colour + price optimizer · businessName/currency → menu view+PDF ·
//   vat → net-based FC + suggested-price gross (menu editor calcFC + menu view) ·
//   kdsRefreshSec → the KDS auto-refresh loop · orderSafetyDays/orderHorizonDays → order-calendar ·
//   lowStockMultiplier → low-stock alerts (morning + order-calendar + stockClass).
// No init-coupling: nothing here runs in the boot fan-out.

const APP_VERSION = '1.0';        // human-facing app version
const APP_BUILD   = 162;          // tracks the service-worker cache build (bump together)
const KMEP_SETTINGS_KEY = 'kmep_settings';

// Defaults are also the fallbacks passed at each read site, kept here for the form + documentation.
const KMEP_SETTINGS_DEFAULTS = {
  bizType: 'restaurant',
  bizName: (typeof window !== 'undefined' && window.KMEP_CONFIG && window.KMEP_CONFIG.businessName) || '212 Nooch Richti',
  currency: 'CHF',
  vat: '',                 // % — blank = not set
  targetFC: 33,            // target food-cost %
  contactEmail: '',
  kdsRefreshSec: 60,
  orderSafetyDays: 0.5,
  orderHorizonDays: 2,
  lowStockMultiplier: 1,   // warn when qty <= minimum × this (1 = at minimum; 1.5 = 50% earlier)
};

// Suggested target food-cost % by business type (informational hint, not enforced).
const _BIZ_TYPE_FC_HINT = { restaurant: 30, foodtruck: 28, bakery: 25, cafe: 24, catering: 32, other: 30 };

// Cache the merged settings object so kmepSetting()/kmepSettingNum() (called in hot render paths:
// calcFC, stockClass, buildMenuPdfHtml…) don't re-parse localStorage every call. Invalidated on our
// own writes and on cross-tab storage events.
let _settingsCache = null;
function _loadSettings() {
  if (_settingsCache) return _settingsCache;
  try { _settingsCache = { ...KMEP_SETTINGS_DEFAULTS, ...(JSON.parse(localStorage.getItem(KMEP_SETTINGS_KEY) || '{}')) }; }
  catch (e) { _settingsCache = { ...KMEP_SETTINGS_DEFAULTS }; }
  return _settingsCache;
}
function _saveSettings(obj) {
  _settingsCache = { ...KMEP_SETTINGS_DEFAULTS, ...obj };
  try { localStorage.setItem(KMEP_SETTINGS_KEY, JSON.stringify(obj)); } catch (e) {}
}
try { window.addEventListener('storage', e => { if (e.key === KMEP_SETTINGS_KEY) _settingsCache = null; }); } catch (e) {}

// Global accessors used by other modules. Always tolerate a missing store.
function kmepSetting(key, fallback) {
  const s = _loadSettings();
  const v = s[key];
  return (v === undefined || v === null || v === '') ? fallback : v;
}
function kmepSettingNum(key, fallback) {
  const n = parseFloat(kmepSetting(key, fallback));
  return isNaN(n) ? fallback : n;
}

// Persist one field and apply any live side-effects.
function saveSettingField(key, value) {
  const s = _loadSettings();
  s[key] = value;
  _saveSettings(s);
  // Live re-renders where a change is immediately visible
  if (key === 'targetFC' || key === 'businessName' || key === 'currency') {
    if (typeof renderMenuEngineering === 'function' && document.getElementById('panel-menu-engineering')?.classList.contains('active')) {
      try { renderMenuEngineering(); } catch (e) {}
    }
  }
  if (typeof showToast === 'function') showToast('Gespeichert', 'info');
}

function _bindSettingInput(id, key, opts) {
  const el = document.getElementById(id);
  if (!el) return;
  const ev = (opts && opts.event) || 'change';
  el.addEventListener(ev, () => {
    let v = el.value;
    if (opts && opts.num) { const n = parseFloat(v); v = isNaN(n) ? '' : n; }
    saveSettingField(key, v);
    if (id === 'set-biz-type') _reflectBizHint(el.value);
  });
}

function _reflectBizHint(type) {
  const hint = document.getElementById('set-biz-hint');
  if (hint) hint.textContent = 'Typischer Ziel-Foodcost für ' + (type || 'restaurant') + ': ~' + (_BIZ_TYPE_FC_HINT[type] || 30) + '%';
}

// Populate the Settings panel from stored values + current theme/language.
function renderSettings() {
  const s = _loadSettings();
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };

  // Appearance — theme
  const theme = localStorage.getItem('theme') || 'dark';
  document.getElementById('set-theme-dark') ?.classList.toggle('set-seg-active', theme === 'dark');
  document.getElementById('set-theme-light')?.classList.toggle('set-seg-active', theme === 'light');
  // Appearance — language
  set('set-lang', localStorage.getItem('kmep_lang') || 'en');

  // Business profile
  set('set-biz-type', s.bizType);
  set('set-biz-name', s.bizName);
  set('set-currency', s.currency);
  set('set-vat', s.vat);
  set('set-target-fc', s.targetFC);
  set('set-contact-email', s.contactEmail);
  _reflectBizHint(s.bizType);

  // Operations
  set('set-kds-refresh', s.kdsRefreshSec);
  set('set-order-safety', s.orderSafetyDays);
  set('set-order-horizon', s.orderHorizonDays);
  set('set-lowstock-mult', s.lowStockMultiplier);

  // About
  const ver = document.getElementById('set-version');
  if (ver) ver.textContent = 'Version ' + APP_VERSION + ' · build ' + APP_BUILD;

  // Bind once (idempotent guard)
  if (!renderSettings._bound) {
    document.getElementById('set-lang')?.addEventListener('change', function () {
      if (typeof settingsSetLang === 'function') settingsSetLang(this.value);
    });
    _bindSettingInput('set-biz-type', 'bizType');
    _bindSettingInput('set-biz-name', 'bizName');
    _bindSettingInput('set-currency', 'currency');
    _bindSettingInput('set-vat', 'vat', { num: true });
    _bindSettingInput('set-target-fc', 'targetFC', { num: true });
    _bindSettingInput('set-contact-email', 'contactEmail');
    _bindSettingInput('set-kds-refresh', 'kdsRefreshSec', { num: true });
    _bindSettingInput('set-order-safety', 'orderSafetyDays', { num: true });
    _bindSettingInput('set-order-horizon', 'orderHorizonDays', { num: true });
    _bindSettingInput('set-lowstock-mult', 'lowStockMultiplier', { num: true });
    renderSettings._bound = true;
  }
}

function settingsSetTheme(mode) {
  if (typeof setTheme === 'function') setTheme(mode);
  else { try { localStorage.setItem('theme', mode); } catch (e) {} document.body.classList.toggle('light', mode === 'light'); }
  document.getElementById('set-theme-dark') ?.classList.toggle('set-seg-active', mode === 'dark');
  document.getElementById('set-theme-light')?.classList.toggle('set-seg-active', mode === 'light');
}

function settingsSetLang(lang) {
  if (typeof setLangDash === 'function') setLangDash(lang);
  else { try { localStorage.setItem('kmep_lang', lang); } catch (e) {} }
  const el = document.getElementById('set-lang'); if (el) el.value = lang;
}

// About actions
function openIntro() { window.location.href = 'onboarding.html?tour=1'; }

function rateApp() {
  const email = kmepSetting('contactEmail', '');
  const name  = kmepSetting('bizName', 'Kitchen MEP');
  if (email) {
    const subj = encodeURIComponent('Kitchen MEP feedback — ' + name);
    const body = encodeURIComponent('My rating (1–5):\n\nWhat works well:\n\nWhat could be better:\n');
    window.location.href = 'mailto:' + email + '?subject=' + subj + '&body=' + body;
  } else if (typeof showToast === 'function') {
    showToast('Set a contact email in Business Profile to enable feedback', 'warn');
  } else {
    alert('Set a contact email in Business Profile to send feedback.');
  }
}

// ── Kitchen device PIN (scan-station lock, Admin panel) ──────────────────────
// The PIN itself lives server-side in app_settings, which the anon key cannot read;
// set_access_pin() requires an active Admin/Küchenchef/Manager worker PIN to change
// it, and verify_access_pin() (used by js/lock.js on index.html) only ever answers
// true/false. Nothing here puts the PIN in the browser or in git.
async function refreshDevicePinState() {
  const el = document.getElementById('dp-state');
  if (!el) return;
  try {
    const res = await fetch(SB_URL + '/rest/v1/rpc/access_pin_is_set', { method: 'POST', headers: _sbH, body: '{}' });
    const on  = await res.json();
    el.textContent = on
      ? '● Lock is ON — the scan station asks for the kitchen PIN.'
      : '○ Lock is OFF — anyone with the link can open the scan station.';
    el.style.color = on ? 'var(--green)' : 'var(--amber)';
  } catch (e) { el.textContent = ''; }
}

async function saveDevicePin() {
  const adminEl = document.getElementById('dp-admin'), newEl = document.getElementById('dp-new');
  const admin = (adminEl.value || '').trim(), pin = (newEl.value || '').trim();
  if (!/^\d{4}$/.test(admin)) { adminMsg('dp-msg', 'Enter your own 4-digit PIN (Admin, Küchenchef or Manager)', 'err'); return; }
  if (!/^\d{4}$/.test(pin))   { adminMsg('dp-msg', 'The kitchen PIN must be exactly 4 digits', 'err'); return; }
  try {
    const res = await fetch(SB_URL + '/rest/v1/rpc/set_access_pin', {
      method: 'POST', headers: _sbH,
      body: JSON.stringify({ p_admin_pin: admin, p_new_pin: pin })
    });
    if (!res.ok) throw new Error(await res.text());
    if (await res.json() === true) {
      adminMsg('dp-msg', '✓ Saved — the scan station now asks for this PIN', 'ok');
      adminEl.value = ''; newEl.value = '';
      refreshDevicePinState();
    } else {
      adminMsg('dp-msg', 'Your PIN was not accepted — it must belong to an active Admin, Küchenchef or Manager', 'err');
    }
  } catch (e) { adminMsg('dp-msg', 'Error: ' + (e.message || e), 'err'); }
}
