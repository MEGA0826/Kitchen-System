// ─────────────────────────────────────────────
// i18n.js — Kitchen MEP Translation Dictionary
// Shared by index.html and dashboard.html
// ─────────────────────────────────────────────

const LANGS = ['en', 'de', 'th', 'it', 'fr', 'es'];
const LANG_LABELS = { en: 'EN', de: 'DE', th: 'TH', it: 'IT', fr: 'FR', es: 'ES' };

const TRANSLATIONS = {

  // ── General ──────────────────────────────────
  dashboard:        { en:'Dashboard',       de:'Dashboard',        th:'แดชบอร์ด',         it:'Dashboard',      fr:'Tableau de bord', es:'Panel' },
  back:             { en:'Back',            de:'Zurück',           th:'กลับ',             it:'Indietro',       fr:'Retour',          es:'Volver' },
  save:             { en:'Save',            de:'Speichern',        th:'บันทึก',           it:'Salva',          fr:'Enregistrer',     es:'Guardar' },
  cancel:           { en:'Cancel',          de:'Abbrechen',        th:'ยกเลิก',           it:'Annulla',        fr:'Annuler',         es:'Cancelar' },
  confirm:          { en:'Confirm',         de:'Bestätigen',       th:'ยืนยัน',           it:'Conferma',       fr:'Confirmer',       es:'Confirmar' },
  close:            { en:'Close',           de:'Schliessen',       th:'ปิด',              it:'Chiudi',         fr:'Fermer',          es:'Cerrar' },
  loading:          { en:'Loading…',        de:'Laden…',           th:'กำลังโหลด…',       it:'Caricamento…',   fr:'Chargement…',     es:'Cargando…' },
  search:           { en:'Search',          de:'Suchen',           th:'ค้นหา',            it:'Cerca',          fr:'Rechercher',      es:'Buscar' },
  filter:           { en:'Filter',          de:'Filter',           th:'กรอง',             it:'Filtro',         fr:'Filtrer',         es:'Filtrar' },
  all:              { en:'All',             de:'Alle',             th:'ทั้งหมด',           it:'Tutti',          fr:'Tous',            es:'Todos' },
  none:             { en:'None',            de:'Keine',            th:'ไม่มี',             it:'Nessuno',        fr:'Aucun',           es:'Ninguno' },
  yes:              { en:'Yes',             de:'Ja',               th:'ใช่',              it:'Sì',             fr:'Oui',             es:'Sí' },
  no:               { en:'No',             de:'Nein',             th:'ไม่',              it:'No',             fr:'Non',             es:'No' },
  edit:             { en:'Edit',            de:'Bearbeiten',       th:'แก้ไข',            it:'Modifica',       fr:'Modifier',        es:'Editar' },
  delete:           { en:'Delete',          de:'Löschen',          th:'ลบ',               it:'Elimina',        fr:'Supprimer',       es:'Eliminar' },
  add:              { en:'Add',             de:'Hinzufügen',       th:'เพิ่ม',             it:'Aggiungi',       fr:'Ajouter',         es:'Agregar' },
  send:             { en:'Send',            de:'Senden',           th:'ส่ง',              it:'Invia',          fr:'Envoyer',         es:'Enviar' },
  export:           { en:'Export',          de:'Exportieren',      th:'ส่งออก',           it:'Esporta',        fr:'Exporter',        es:'Exportar' },
  'no-data':        { en:'No data',         de:'Keine Daten',      th:'ไม่มีข้อมูล',       it:'Nessun dato',    fr:'Aucune donnée',   es:'Sin datos' },
  error:            { en:'Error',           de:'Fehler',           th:'ข้อผิดพลาด',        it:'Errore',         fr:'Erreur',          es:'Error' },
  success:          { en:'Success',         de:'Erfolg',           th:'สำเร็จ',            it:'Successo',       fr:'Succès',          es:'Éxito' },
  undo:             { en:'Undo',            de:'Rückgängig',       th:'เลิกทำ',           it:'Annulla',        fr:'Annuler',         es:'Deshacer' },

  // ── Auth / PIN ────────────────────────────────
  'enter-pin':      { en:'Enter PIN',       de:'PIN eingeben',     th:'ใส่ PIN',           it:'Inserisci PIN',  fr:'Entrer le PIN',   es:'Ingresar PIN' },
  'pin-wrong':      { en:'Wrong PIN',       de:'Falscher PIN',     th:'PIN ไม่ถูกต้อง',    it:'PIN errato',     fr:'PIN incorrect',   es:'PIN incorrecto' },
  'select-worker':  { en:'Select worker',   de:'Mitarbeiter wählen', th:'เลือกพนักงาน',   it:'Seleziona lavoratore', fr:'Choisir un employé', es:'Seleccionar trabajador' },

  // ── Staff Home ────────────────────────────────
  'to-produce':     { en:'To Produce',      de:'Zu produzieren',   th:'ต้องผลิต',          it:'Da produrre',    fr:'À produire',      es:'A producir' },
  available:        { en:'Available',       de:'Verfügbar',        th:'มีพร้อม',           it:'Disponibile',    fr:'Disponible',      es:'Disponible' },
  priority:         { en:'Priority',        de:'Priorität',        th:'ลำดับความสำคัญ',    it:'Priorità',       fr:'Priorité',        es:'Prioridad' },
  'sort-az':        { en:'A–Z',             de:'A–Z',              th:'A–Z',              it:'A–Z',            fr:'A–Z',             es:'A–Z' },
  colour:           { en:'Colour',          de:'Farbe',            th:'สี',               it:'Colore',         fr:'Couleur',         es:'Color' },
  produce:          { en:'Produce',         de:'Produzieren',      th:'ผลิต',             it:'Produrre',       fr:'Produire',        es:'Producir' },
  done:             { en:'Done',            de:'Fertig',           th:'เสร็จแล้ว',         it:'Fatto',          fr:'Terminé',         es:'Listo' },
  waste:            { en:'Waste',           de:'Abfall',           th:'ของเสีย',           it:'Scarto',         fr:'Déchet',          es:'Desperdicio' },
  used:             { en:'Used',            de:'Verwendet',        th:'ใช้แล้ว',           it:'Usato',          fr:'Utilisé',         es:'Usado' },
  target:           { en:'Target',          de:'Ziel',             th:'เป้าหมาย',          it:'Obiettivo',      fr:'Objectif',        es:'Meta' },
  'shelf-life':     { en:'Shelf life',      de:'Haltbarkeit',      th:'อายุการเก็บ',        it:'Durata',         fr:'Durée de vie',    es:'Vida útil' },
  expired:          { en:'Expired',         de:'Abgelaufen',       th:'หมดอายุ',           it:'Scaduto',        fr:'Périmé',          es:'Vencido' },
  'exp-today':      { en:'Expires today',   de:'Läuft heute ab',   th:'หมดอายุวันนี้',     it:'Scade oggi',     fr:'Expire aujourd\'hui', es:'Vence hoy' },
  'exp-days':       { en:'d left',          de:'T übrig',          th:'วัน',              it:'g rimasti',      fr:'j restants',      es:'d restantes' },
  qty:              { en:'Qty',             de:'Menge',            th:'จำนวน',            it:'Qtà',            fr:'Qté',             es:'Cant.' },
  kg:               { en:'kg',              de:'kg',               th:'กก.',              it:'kg',             fr:'kg',              es:'kg' },
  scan:             { en:'Scan',            de:'Scannen',          th:'สแกน',             it:'Scansiona',      fr:'Scanner',         es:'Escanear' },

  // ── Categories ────────────────────────────────
  gemüse:           { en:'Vegetables',      de:'Gemüse',           th:'ผัก',              it:'Verdure',        fr:'Légumes',         es:'Verduras' },
  fleisch:          { en:'Meat',            de:'Fleisch',          th:'เนื้อ',             it:'Carne',          fr:'Viande',          es:'Carne' },
  protein:          { en:'Protein',         de:'Protein',          th:'โปรตีน',           it:'Proteine',       fr:'Protéines',       es:'Proteína' },
  sauce:            { en:'Sauce',           de:'Sauce',            th:'ซอส',              it:'Salsa',          fr:'Sauce',           es:'Salsa' },

  // ── Dashboard Tabs ────────────────────────────
  kds:              { en:'KDS',             de:'KDS',              th:'KDS',              it:'KDS',            fr:'KDS',             es:'KDS' },
  'mep-overview':   { en:'MEP Overview',    de:'MEP Übersicht',    th:'ภาพรวม MEP',        it:'Panoramica MEP', fr:'Vue MEP',         es:'Vista MEP' },
  inventory:        { en:'Inventory',       de:'Inventar',         th:'คลังสินค้า',        it:'Inventario',     fr:'Inventaire',      es:'Inventario' },
  products:         { en:'Products',        de:'Produkte',         th:'สินค้า',            it:'Prodotti',       fr:'Produits',        es:'Productos' },
  recipes:          { en:'Recipes',         de:'Rezepte',          th:'สูตร',             it:'Ricette',        fr:'Recettes',        es:'Recetas' },
  orders:           { en:'Orders',          de:'Bestellungen',     th:'คำสั่ง',            it:'Ordini',         fr:'Commandes',       es:'Pedidos' },
  reports:          { en:'Reports',         de:'Berichte',         th:'รายงาน',           it:'Rapporti',       fr:'Rapports',        es:'Informes' },
  deductions:       { en:'Deductions',      de:'Abzüge',           th:'การหักออก',         it:'Deduzioni',      fr:'Déductions',      es:'Deducciones' },
  admin:            { en:'Admin',           de:'Admin',            th:'แอดมิน',           it:'Admin',          fr:'Admin',           es:'Admin' },

  // ── KDS ───────────────────────────────────────
  'scans-today':    { en:'Scans today',     de:'Scans heute',      th:'สแกนวันนี้',        it:'Scansioni oggi', fr:'Scans aujourd\'hui', es:'Escaneos hoy' },
  produced:         { en:'Produced',        de:'Produziert',       th:'ผลิตแล้ว',         it:'Prodotto',       fr:'Produit',         es:'Producido' },
  workers:          { en:'Workers',         de:'Mitarbeiter',      th:'พนักงาน',          it:'Lavoratori',     fr:'Employés',        es:'Trabajadores' },
  'live-feed':      { en:'Live feed',       de:'Live-Feed',        th:'ฟีดสด',            it:'Feed live',      fr:'Flux en direct',  es:'Feed en vivo' },
  'no-scans':       { en:'No scans today',  de:'Keine Scans heute', th:'ไม่มีสแกนวันนี้',  it:'Nessuna scansione oggi', fr:'Aucun scan aujourd\'hui', es:'Sin escaneos hoy' },

  // ── MEP Overview ──────────────────────────────
  'on-track':       { en:'On track',        de:'Im Plan',          th:'ตามแผน',           it:'In linea',       fr:'Dans les temps',  es:'En camino' },
  'needs-attention':{ en:'Needs attention', de:'Benötigt Aufmerksamkeit', th:'ต้องดูแล',   it:'Richiede attenzione', fr:'Besoin d\'attention', es:'Necesita atención' },
  'not-started':    { en:'Not started',     de:'Nicht begonnen',   th:'ยังไม่เริ่ม',       it:'Non iniziato',   fr:'Pas commencé',    es:'No iniciado' },

  // ── Products ──────────────────────────────────
  category:         { en:'Category',        de:'Kategorie',        th:'หมวดหมู่',          it:'Categoria',      fr:'Catégorie',       es:'Categoría' },
  code:             { en:'Code',            de:'Code',             th:'รหัส',             it:'Codice',         fr:'Code',            es:'Código' },
  name:             { en:'Name',            de:'Name',             th:'ชื่อ',             it:'Nome',           fr:'Nom',             es:'Nombre' },
  notes:            { en:'Notes',           de:'Notizen',          th:'หมายเหตุ',          it:'Note',           fr:'Notes',           es:'Notas' },
  image:            { en:'Image',           de:'Bild',             th:'รูปภาพ',           it:'Immagine',       fr:'Image',           es:'Imagen' },
  'daily-target':   { en:'Daily target',    de:'Tagesziel',        th:'เป้าหมายรายวัน',    it:'Obiettivo giornaliero', fr:'Objectif quotidien', es:'Meta diaria' },

  // ── Inventory ─────────────────────────────────
  supplier:         { en:'Supplier',        de:'Lieferant',        th:'ผู้จัดจำหน่าย',     it:'Fornitore',      fr:'Fournisseur',     es:'Proveedor' },
  stock:            { en:'Stock',           de:'Bestand',          th:'สต็อก',            it:'Stock',          fr:'Stock',           es:'Stock' },
  unit:             { en:'Unit',            de:'Einheit',          th:'หน่วย',            it:'Unità',          fr:'Unité',           es:'Unidad' },
  price:            { en:'Price',           de:'Preis',            th:'ราคา',             it:'Prezzo',         fr:'Prix',            es:'Precio' },

  // ── Orders ────────────────────────────────────
  'raw-material':   { en:'Raw material',    de:'Rohstoff',         th:'วัตถุดิบ',          it:'Materia prima',  fr:'Matière première', es:'Materia prima' },
  required:         { en:'Required',        de:'Benötigt',         th:'ต้องการ',           it:'Richiesto',      fr:'Requis',          es:'Requerido' },
  'in-stock':       { en:'In stock',        de:'Auf Lager',        th:'ในสต็อก',           it:'In magazzino',   fr:'En stock',        es:'En stock' },
  'to-order':       { en:'To order',        de:'Zu bestellen',     th:'ต้องสั่ง',          it:'Da ordinare',    fr:'À commander',     es:'A pedir' },

  // ── Reports ───────────────────────────────────
  'weekly-waste':   { en:'Weekly waste',    de:'Wöchentlicher Abfall', th:'ของเสียรายสัปดาห์', it:'Scarto settimanale', fr:'Déchets hebdomadaires', es:'Desperdicio semanal' },
  'send-report':    { en:'Send report',     de:'Bericht senden',   th:'ส่งรายงาน',         it:'Invia rapporto', fr:'Envoyer le rapport', es:'Enviar informe' },

  // ── Admin ─────────────────────────────────────
  role:             { en:'Role',            de:'Rolle',            th:'บทบาท',            it:'Ruolo',          fr:'Rôle',            es:'Rol' },
  pin:              { en:'PIN',             de:'PIN',              th:'PIN',              it:'PIN',            fr:'PIN',             es:'PIN' },
  'add-worker':     { en:'Add worker',      de:'Mitarbeiter hinzufügen', th:'เพิ่มพนักงาน', it:'Aggiungi lavoratore', fr:'Ajouter un employé', es:'Agregar trabajador' },
  archive:          { en:'Archive',         de:'Archiv',           th:'เก็บถาวร',          it:'Archivio',       fr:'Archive',         es:'Archivo' },
  'scan-archive':   { en:'Scan archive',    de:'Scan-Archiv',      th:'ไฟล์สแกน',          it:'Archivio scansioni', fr:'Archive des scans', es:'Archivo de escaneos' },

};

// ─────────────────────────────────────────────
// Core functions
// ─────────────────────────────────────────────

let currentLang = localStorage.getItem('kmep_lang') || 'en';

/** Translate a key, fall back to EN, then to the key itself */
function t(key, lang) {
  const l = lang || currentLang;
  const entry = TRANSLATIONS[key];
  if (!entry) return key;
  return entry[l] || entry['en'] || key;
}

/** Set language, persist, re-render all data-i18n elements */
function setLang(lang) {
  if (!LANGS.includes(lang)) return;
  currentLang = lang;
  localStorage.setItem('kmep_lang', lang);
  applyLang();
  // Notify page-level refresh if needed
  if (typeof onLangChange === 'function') onLangChange(lang);
}

/** Apply translations to all elements with data-i18n attribute */
function applyLang() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.dataset.i18n;
    el.textContent = t(key);
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    el.placeholder = t(el.dataset.i18nPlaceholder);
  });
  // Update active state on lang switcher buttons
  document.querySelectorAll('.lang-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.lang === currentLang);
  });
}

/** Render the language switcher HTML — call once in each page's init */
function renderLangSwitcher(containerId) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = LANGS.map(l =>
    `<button class="lang-btn${l === currentLang ? ' active' : ''}" data-lang="${l}" onclick="setLang('${l}')">${LANG_LABELS[l]}</button>`
  ).join('');
}
