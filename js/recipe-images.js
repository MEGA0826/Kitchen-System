/* recipe-images.js — shared recipe/menu image helpers (module 19), extracted from dashboard.html.
   previewMenuImg/loadDriveImg/removeMenuImage drive the menu popup's image preview; _uploadMenuImage
   uploads the menu image; _uploadItemImage is the SHARED uploader called by gr-edit / inventory-edit /
   mep-edit / product-edit. Shared state `_menuImgFile` stays INLINE (also written by menu-edit's
   openMenuPopup + saveMenuEntry); these fns read/write it via the global lexical env. All entry points
   are event-driven (inline onchange/oninput/onclick + async save handlers). Reads globals SB_URL, SB_KEY. */
function previewMenuImg(input) {
  const file = input.files[0]; if (!file) return;
  _menuImgFile = file;
  const reader = new FileReader();
  reader.onload = e => {
    document.getElementById('mp-img-el').src = e.target.result;
    document.getElementById('mp-img-preview').style.display = 'block';
  };
  reader.readAsDataURL(file);
}

async function _uploadItemImage(file, prefix) {
  const ext  = (file.name.split('.').pop() || 'jpg').toLowerCase();
  const path = `${prefix}-${Date.now()}.${ext}`;
  const res  = await fetch(`${SB_URL}/storage/v1/object/menu-images/${path}`, {
    method : 'POST',
    headers: { 'Authorization': `Bearer ${SB_KEY}`, 'apikey': SB_KEY, 'x-upsert': 'true', 'Content-Type': file.type || 'image/jpeg' },
    body   : file
  });
  if (!res.ok) {
    const msg = await res.text().catch(() => res.status);
    throw new Error('Bild-Upload fehlgeschlagen: ' + msg);
  }
  return `${SB_URL}/storage/v1/object/public/menu-images/${path}`;
}

async function _uploadMenuImage(file) {
  const ext  = (file.name.split('.').pop() || 'jpg').toLowerCase();
  const path = `menu-${Date.now()}.${ext}`;
  const res  = await fetch(`${SB_URL}/storage/v1/object/menu-images/${path}`, {
    method : 'POST',
    headers: { 'Authorization': `Bearer ${SB_KEY}`, 'apikey': SB_KEY, 'x-upsert': 'true', 'Content-Type': file.type || 'image/jpeg' },
    body   : file
  });
  if (!res.ok) {
    const msg = await res.text().catch(() => res.status);
    throw new Error('Bild-Upload fehlgeschlagen: ' + msg);
  }
  return `${SB_URL}/storage/v1/object/public/menu-images/${path}`;
}

function loadDriveImg(url) {
  if (!url) return;
  document.getElementById('mp-img-el').src = url;
  document.getElementById('mp-img-preview').style.display = 'block';
}
function removeMenuImage() {
  const imgEl = document.getElementById('mp-img-el');
  if (imgEl) imgEl.src = '';
  document.getElementById('mp-img-preview').style.display = 'none';
  document.getElementById('mp-drive-url').value = '';
  document.getElementById('mp-img-file').value = '';
  _menuImgFile = null;
}
