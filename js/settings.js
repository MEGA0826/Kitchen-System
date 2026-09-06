// Kitchen MEP — Settings panel (module 16), classic script. Event-driven: renderSettings() runs
// from the header gear (openSettings, in dashboard.html); field handlers persist on change. Appearance delegates to the existing
// setTheme (dashboard) + setLangDash (i18n). Business/Operations values are stored in localStorage
// under `kmep_settings` and read elsewhere via the global kmepSetting()/kmepSettingNum() accessors:
//   targetFC → menu-view FC colour + menu-engineering · businessName/currency → menu view+PDF ·
//   kdsRefreshSec → the KDS auto-refresh loop · orderSafetyDays/orderHorizonDays → order-calendar.
// No init-coupling: nothing here runs in the boot fan-out.

const APP_VERSION = '1.0';        // human-facing app version
const APP_BUILD   = 133;          // tracks the service-worker cache build (bump together)
const KMEP_SETTINGS_KEY = 'kmep_settings';

// Defaults are also the fallbacks passed at each read site, kept here for the form + documentation.
const KMEP_SETTINGS_DEFAULTS = {
  bizType: 'restaurant',
  bizName: '212 Nooch Richti',
  currency: 'CHF',
  vat: '',                 // % — blank = not set
  targetFC: 33,            // target food-cost %
  contactEmail: '',
  kdsRefreshSec: 60,
  orderSafetyDays: 0.5,
  orderHorizonDays: 2,
};

// Suggested target food-cost % by business type (informational hint, not enforced).
const _BIZ_TYPE_FC_HINT = { restaurant: 30, foodtruck: 28, bakery: 25, cafe: 24, catering: 32, other: 30 };

function _loadSettings() {
  try { return { ...KMEP_SETTINGS_DEFAULTS, ...(JSON.parse(localStorage.getItem(KMEP_SETTINGS_KEY) || '{}')) }; }
  catch (e) { return { ...KMEP_SETTINGS_DEFAULTS }; }
}
function _saveSettings(obj) {
  try { localStorage.setItem(KMEP_SETTINGS_KEY, JSON.stringify(obj)); } catch (e) {}
}

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
