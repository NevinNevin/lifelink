/* LifeLink front end. All records live in Google Sheets via the Apps Script API.
   sessionStorage holds only the login token for the current tab. */
/* API_URL is defined in js/config.js (the only line you edit). */
const BUILD = 'lifelink-app-2026-11-01-sheets-only';
console.info('LifeLink app.js build:', BUILD, '| API:', typeof API_URL !== 'undefined' ? API_URL : 'not set');
const GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-', 'Bombay', 'Rh Null'];
const COMPS = ['Whole Blood', 'RBC', 'Plasma', 'Platelets', 'Cryoprecipitate'];
const SEV = ['Mild', 'Moderate', 'Severe', 'Life-threatening'];
const $ = (s, r = document) => r.querySelector(s);
const h = (t, a = {}, ...k) => {
  const e = document.createElement(t);
  for (const [x, v] of Object.entries(a)) {
    if (x.startsWith('on')) e.addEventListener(x.slice(2), v);
    else if (x === 'class') e.className = v;
    else if (v !== false && v != null) e.setAttribute(x, v === true ? '' : v);
  }
  k.flat(9).forEach(c => e.append(c instanceof Node ? c : document.createTextNode(c ?? '')));
  return e;
};
let S = JSON.parse(sessionStorage.getItem('ll_session') || 'null'), timer = null, CMP = null;
const today = () => new Date().toISOString().slice(0, 10);
const pill = (t, c) => h('span', { class: 'pill ' + (c || t) }, t);

async function api(action, data = {}) {
  if (typeof API_URL === 'undefined' || !/^https:\/\/script\.google\.com\/(a\/[^/]+\/)?macros\/s\/[\w-]{20,}\/exec$/.test(API_URL)) throw new Error('API_URL is not set. Edit js/config.js and paste your Apps Script Web app URL.');
  let r;
  try {
    r = await fetch(API_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action, token: S && S.token, data }) });
  } catch (e) { throw new Error('Cannot reach the server. Check your connection and API_URL in js/app.js.'); }
  const j = await r.json();
  if (!j.ok) { if (/Not authorised/.test(j.error) && S) { logout(); toast('Session expired. Sign in again.', true); } throw new Error(j.error); }
  return j.data;
}
function toast(m, bad) { const t = $('#toast'); t.textContent = m; t.className = bad ? 'bad show' : 'show'; clearTimeout(toast.t); toast.t = setTimeout(() => t.className = '', 4500); }

function form(fields, cb, label = 'Save', init = {}) {
  const f = h('form', { class: 'form' });
  fields.forEach(x => {
    const v = init[x.n] ?? x.v ?? '';
    let i;
    if (x.t === 'select') i = h('select', { name: x.n }, x.o.map(o => { const [ov, ol] = Array.isArray(o) ? o : [o, o]; return h('option', { value: ov, selected: String(ov) === String(v) }, ol); }));
    else if (x.t === 'textarea') i = h('textarea', { name: x.n, rows: 3 }, v);
    else if (x.t === 'check') i = h('input', { type: 'checkbox', name: x.n, checked: v === 'Yes' || v === true });
    else i = h('input', Object.assign({ type: x.t || 'text', name: x.n, value: v, required: x.r !== false }, x.a || {}));
    f.append(h('label', { class: x.t === 'check' ? 'chk' : '' }, x.t === 'check' ? [i, x.l] : [x.l, i]));
  });
  const b = h('button', { class: 'btn', type: 'submit' }, label);
  f.append(b);
  f.addEventListener('submit', async e => {
    e.preventDefault();
    const o = {};
    fields.forEach(x => { const el = f.elements[x.n]; o[x.n] = x.t === 'check' ? (el.checked ? 'Yes' : 'No') : el.value.trim(); });
    b.disabled = true;
    try { await cb(o, f); } catch (err) { toast(err.message, true); }
    b.disabled = false;
  });
  return f;
}
function table(cols, rows, acts = []) {
  if (!rows.length) return h('p', { class: 'empty' }, 'No records yet.');
  return h('div', { class: 'tw' }, h('table', {},
    h('thead', {}, h('tr', {}, cols.map(c => h('th', {}, c[1])), acts.length ? h('th', {}, 'Actions') : '')),
    h('tbody', {}, rows.map(r => h('tr', {}, cols.map(c => h('td', {}, c[2] ? c[2](r) : r[c[0]])),
      acts.length ? h('td', { class: 'acts' }, acts.filter(a => !a[2] || a[2](r)).map(a => h('button', { class: 'btn s', onclick: () => a[1](r) }, a[0]))) : '')))));
}
function modal(title, ...body) {
  const d = $('#dlg');
  d.replaceChildren(h('div', { class: 'mh' }, h('h3', {}, title), h('button', { class: 'btn s ghost', onclick: () => d.close() }, 'Close')), ...body);
  d.showModal();
}
function page(title, ...nodes) { $('#main').replaceChildren(h('h2', {}, title), ...nodes); }
const panel = (t, ...n) => h('div', { class: 'panel glass' }, t ? h('h3', {}, t) : '', ...n);
const tiles = list => h('div', { class: 'grid' }, list.map(([l, v, c]) => h('div', { class: 'tile ' + (c || '') }, h('small', {}, l), h('strong', {}, v ?? 0))));
const opts = (rows, id, lab) => rows.map(r => [r[id], r[id] + ' – ' + lab(r)]);
function csv(rows) {
  if (!rows.length) return '';
  const k = Object.keys(rows[0]);
  const q = v => { let s = String(v ?? ''); if (/^[=+\-@]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"'; };
  return [k.map(q), ...rows.map(r => k.map(c => q(r[c])))].map(r => r.join(',')).join('\n');
}
function download(name, rows) {
  const a = h('a', { href: URL.createObjectURL(new Blob([csv(rows)], { type: 'text/csv' })), download: name + '-' + today() + '.csv' });
  document.body.append(a); a.click(); a.remove();
}

/* ---------------- auth ---------------- */
const donorReg = [
  { n: 'FullName', l: 'Full name' }, { n: 'IDName', l: 'Name exactly as on Emirates ID' },
  { n: 'EmiratesID', l: 'Emirates ID (784-YYYY-NNNNNNN-N)', a: { placeholder: '784-1990-1234567-1' } },
  { n: 'DateOfBirth', l: 'Date of birth', t: 'date' }, { n: 'Height', l: 'Height (cm)', t: 'number', a: { min: 100, max: 250 } },
  { n: 'Weight', l: 'Weight (kg, min 50)', t: 'number', a: { min: 50, max: 300 } }, { n: 'Phone', l: 'Phone', t: 'tel' },
  { n: 'Gmail', l: 'Gmail address', t: 'email', a: { placeholder: 'name@gmail.com' } },
  { n: 'BloodGroup', l: 'Blood group', t: 'select', o: GROUPS }, { n: 'Password', l: 'Password (8+ characters)', t: 'password', a: { minlength: 8 } }
];
const hospReg = [
  { n: 'HospitalName', l: 'Hospital name' }, { n: 'LicenseNumber', l: 'License number' }, { n: 'Email', l: 'Email', t: 'email' },
  { n: 'Phone', l: 'Phone', t: 'tel' }, { n: 'Address', l: 'Address' }, { n: 'City', l: 'City' },
  { n: 'HospitalType', l: 'Type', t: 'select', o: ['Government', 'Private', 'Clinic', 'Teaching'] },
  { n: 'BloodBankAvailable', l: 'Blood bank on site', t: 'select', o: ['Yes', 'No'] },
  { n: 'EmergencyContact', l: 'Emergency contact number', t: 'tel' }, { n: 'Password', l: 'Password (8+ characters)', t: 'password', a: { minlength: 8 } }
];
function showAuth(role = 'donor', mode = 'login') {
  clearInterval(timer);
  $('#app').hidden = true;
  const a = $('#auth'); a.hidden = false;
  const idf = { donor: 'DonorID', hospital: 'HospitalID', admin: 'Username' }[role];
  const loginFields = [{ n: idf, l: role === 'admin' ? 'Admin username' : role === 'donor' ? 'Donor ID' : 'Hospital ID' }, { n: 'Password', l: 'Password', t: 'password' }];
  let f;
  if (mode === 'login') f = form(loginFields, async o => { afterLogin(await api({ donor: 'loginDonor', hospital: 'loginHospital', admin: 'loginAdmin' }[role], o)); }, 'Sign in');
  else f = form(role === 'donor' ? donorReg : hospReg, async o => {
    const r = await api(role === 'donor' ? 'createDonor' : 'createHospital', o);
    const id = r.DonorID || r.HospitalID;
    modal('Registration complete', h('p', {}, 'Your ID is:'), h('h2', {}, id), h('p', {}, 'Save this ID. You need it with your password to sign in.'));
    showAuth(role, 'login');
  }, 'Create account');
  a.replaceChildren(h('div', { class: 'acard glass' },
    h('div', { class: 'brand' }, h('span', { class: 'drop' }), h('span', {}, 'Life', h('b', {}, 'Link'))),
    h('p', { class: 'tagline' }, 'Smart transfusion & monitoring system'),
    h('small', { class: 'tagline' }, 'Build: ' + BUILD),
    h('div', { class: 'tabs' }, ['donor', 'hospital', 'admin'].map(r => h('button', { class: 'tab', 'aria-pressed': r === role, onclick: () => showAuth(r, 'login') }, r[0].toUpperCase() + r.slice(1)))),
    role !== 'admin' ? h('div', { class: 'tabs' }, ['login', 'register'].map(m => h('button', { class: 'tab', 'aria-pressed': m === mode, onclick: () => showAuth(role, m) }, m === 'login' ? 'Sign in' : 'Register'))) : '',
    f));
}
function afterLogin(r) { S = r; sessionStorage.setItem('ll_session', JSON.stringify(r)); boot(); }
function logout() { S = null; sessionStorage.removeItem('ll_session'); showAuth(); }

/* ---------------- shell ---------------- */
const NAV = {
  donor: [['Overview', vDonorHome], ['My Details', vMyDetails], ['Donate', vDonate], ['History', vHistory], ['HLA typing', vDonorHla], ['Rewards', vRewards], ['Compatibility', vCompat]],
  hospital: [['Dashboard', vDash], ['Patients', vPatients], ['HLA match', vMatch], ['Inventory', vInv], ['Donations', vHospDon], ['Reactions', vReact], ['Emergency', vEmerg], ['Compatibility', vCompat]],
  admin: [['Dashboard', vDash], ['Donors', vAdmDonors], ['Hospitals', () => listView('Hospitals', 'getHospitals', ['HospitalID', 'HospitalName', 'LicenseNumber', 'Email', 'Phone', 'City', 'HospitalType', 'BloodBankAvailable', 'RegistrationDate'])],
    ['Patients', () => listView('Patients', 'getPatients', ['PatientID', 'FirstName', 'LastName', 'DOB', 'Gender', 'BloodGroup', 'HospitalID', 'RegistrationDate'])],
    ['Inventory', vInv], ['Reactions', vReact], ['Emergency', vEmerg], ['Fraud', vFraud],
    ['Audit logs', () => listView('Audit logs', 'getAuditLogs', ['Timestamp', 'UserType', 'UserID', 'Action', 'Description'])], ['Export', vExport]]
};
function boot() {
  $('#auth').hidden = true; $('#app').hidden = false;
  const items = NAV[S.role];
  $('#nav').replaceChildren(h('div', { class: 'brand' }, h('span', { class: 'drop' }), h('span', {}, 'Life', h('b', {}, 'Link'))),
    ...items.map((it, i) => h('button', { onclick: () => go(i) }, it[0])));
  $('#bar').replaceChildren(h('div', { class: 'who' }, 'Signed in as ', h('b', {}, S.name), ' (' + S.id + ')'), h('button', { class: 'btn s ghost', onclick: logout }, 'Sign out'));
  go(0);
}
function go(i) {
  clearInterval(timer);
  [...$('#nav').querySelectorAll('button')].forEach((b, j) => b.setAttribute('aria-current', j === i ? 'page' : 'false'));
  page(NAV[S.role][i][0], h('p', { class: 'empty' }, 'Loading…'));
  Promise.resolve(NAV[S.role][i][1]()).catch(e => toast(e.message, true));
}
async function compat() { return CMP || (CMP = await api('getCompat')); }

/* ---------------- dashboard ---------------- */
function vDash() {
  const box = h('div');
  page('Dashboard', box);
  const draw = async () => {
    const d = await api('getDashboard');
    const t = [['Total donors', d.donors], ['Total hospitals', d.hospitals], ['Total patients', d.patients], ['Total donations', d.donations], ['Inventory units', d.inventory], ['Emergency cases', d.emergencies, 'red'], ['Reaction reports', d.reactions]];
    box.replaceChildren(tiles(t),
      panel('Top 10 donors', table([['Name', 'Donor'], ['BloodGroup', 'Group', r => r.BloodGroup || ''], ['Donations', 'Donations'], ['Score', 'Excellence'], ['Rank', 'Rank']], d.top10.map(x => Object.assign({ BloodGroup: x.BloodGroup }, x)))),
      S.role === 'donor' ? '' : panel('Upcoming inventory expiry', table([['UnitID', 'Unit'], ['BloodGroup', 'Group'], ['Component', 'Component'], ['Quantity', 'Qty'], ['ExpiryDate', 'Expires']], d.expiring)),
      h('p', { class: 'note' }, 'Live data from Google Sheets. Refreshes every 30 seconds.'));
  };
  draw().catch(e => toast(e.message, true));
  timer = setInterval(() => draw().catch(() => { }), 30000);
}
async function listView(title, action, keys, acts = []) {
  const rows = await api(action);
  page(title, panel('', table(keys.map(k => [k, k]), rows, acts)));
}

/* ---------------- donor ---------------- */
const GAP = { 'Whole Blood': 56, 'Plasma': 28, 'Platelets': 7 };
function recovery(hist) {
  const last = hist.filter(x => x.Status !== 'Cancelled').map(x => x.Date).sort().pop();
  if (!last) return { ready: true, days: 0, pct: 100, last: null };
  const since = Math.floor((new Date(today()) - new Date(last)) / 864e5), left = Math.max(0, 56 - since);
  return { ready: left === 0, days: left, pct: Math.min(100, Math.round(since / 56 * 100)), last };
}
function badges(m) {
  const b = [];
  if (+m.LifetimeDonations >= 1) b.push('First Drop');
  if (+m.LifetimeDonations >= 5) b.push('Lifesaver');
  if (+m.LifetimeDonations >= 10) b.push('Ten Club');
  if (+m.EmergencyDonations >= 1) b.push('Emergency Hero');
  if (+m.RareBloodPoints >= 20) b.push('Rare Guardian');
  if (+m.LifetimeDonations > 0 && +m.SafetyPoints === 100) b.push('Safe Donor');
  return b;
}
async function vDonorHome() {
  const [[me], hist] = await Promise.all([api('getDonors'), api('getDonations')]);
  const rc = recovery(hist), bd = badges(me);
  page('Overview',
    tiles([['Lifetime donations', me.LifetimeDonations], ['Emergency donations', me.EmergencyDonations], ['Excellence score', me.ExcellenceScore, 'red'], ['Rank', me.RewardRank]]),
    panel('Recovery tracker',
      h('p', {}, rc.ready ? 'You are eligible to donate whole blood.' : 'Next whole-blood donation in ' + rc.days + ' day(s).'),
      h('div', { class: 'meter' }, h('i', { style: 'width:' + rc.pct + '%' })),
      h('p', { class: 'note' }, 'Whole blood every 56 days, plasma every 28 days, platelets every 7 days.')),
    panel('Achievement badges', bd.length ? h('div', { class: 'badges' }, bd.map(x => pill(x, 'good'))) : h('p', { class: 'empty' }, 'Complete a donation to earn your first badge.')),
    panel('My profile', table([['DonorID', 'ID'], ['FullName', 'Name'], ['BloodGroup', 'Group'], ['Age', 'Age'], ['Height', 'Height'], ['Weight', 'Weight'], ['Phone', 'Phone'], ['Gmail', 'Gmail'], ['Status', 'Status', r => pill(r.EmergencyLock === 'Yes' ? 'Locked' : r.Status, r.EmergencyLock === 'Yes' ? 'bad' : 'good')]], [me])));
}
async function vMyDetails() {
  const rows = await api('getDonors'); // read live from Google Sheets, never cached
  const me = rows.find(x => x.DonorID === S.id);
  if (!me) { page('My Details', h('p', { class: 'empty' }, 'Your record was not found in the database.')); return; }
  page('My Details', panel('', table([['DonorID', 'Donor ID'], ['FullName', 'Name'], ['IDName', 'Name on Emirates ID'], ['EmiratesID', 'Emirates ID'], ['DateOfBirth', 'Date of birth'], ['Age', 'Age'], ['Height', 'Height (cm)'], ['Weight', 'Weight (kg)'],
    ['Phone', 'Phone'], ['Gmail', 'Gmail'], ['BloodGroup', 'Blood group'], ['RegistrationDate', 'Registered'], ['Status', 'Status']], [me])));
}
const SCREEN = [
  ['Do you feel well today?', 'Yes'], ['Did you sleep at least 6 hours?', 'Yes'], ['Have you eaten and had water in the last 4 hours?', 'Yes'],
  ['Fever, infection or antibiotics in the last 14 days?', 'No'], ['Tattoo, piercing or surgery in the last 6 months?', 'No'],
  ['Are you pregnant or breastfeeding?', 'No'], ['Travelled to a malaria-risk area in the last 3 months?', 'No']
];
async function vDonate() {
  const [hosp, hist] = await Promise.all([api('getHospitals'), api('getDonations')]);
  const fields = SCREEN.map((q, i) => ({ n: 's' + i, l: q[0], t: 'select', o: ['Yes', 'No'], v: '' })).map(f => (f.o = ['Select…', 'Yes', 'No'], f));
  fields.push({ n: 'DonationType', l: 'Donation type', t: 'select', o: Object.keys(GAP) }, { n: 'HospitalID', l: 'Hospital', t: 'select', o: opts(hosp, 'HospitalID', r => r.HospitalName + ', ' + r.City) },
    { n: 'EmergencyFlag', l: 'Emergency appeal', t: 'check' }, { n: 'Reason', l: 'Reason (optional)', r: false });
  page('Donate blood',
    panel('Eligibility screening', h('p', { class: 'note' }, 'Answer honestly. Your answers protect you and the patient.'),
      form(fields, async o => {
        const ok = SCREEN.every((q, i) => o['s' + i] === q[1]);
        if (!ok) throw new Error('Based on your answers you cannot donate today. Please try again later or speak to a nurse.');
        await api('createDonation', { DonationType: o.DonationType, HospitalID: o.HospitalID, EmergencyFlag: o.EmergencyFlag, Reason: o.Reason, ScreeningPassed: true });
        toast('Donation scheduled. The hospital will confirm it.'); vDonate();
      }, 'Schedule donation')),
    panel('Recovery', h('p', {}, recovery(hist).ready ? 'Ready to donate.' : 'Next whole-blood donation in ' + recovery(hist).days + ' day(s).')));
}
async function vHistory() {
  const hist = await api('getDonations');
  page('Donation history', panel('', table([['DonationID', 'ID'], ['Date', 'Date'], ['DonationType', 'Type'], ['Status', 'Status'], ['EmergencyFlag', 'Emergency'], ['HospitalID', 'Hospital']], hist.reverse(),
    [['Certificate', r => certificate(r), r => r.Status === 'Completed']])));
}
async function certificate(r) {
  const [[me]] = [await api('getDonors')];
  modal('Donation certificate', h('div', { class: 'cert' }, h('h2', {}, 'Certificate of Donation'), h('p', {}, 'Awarded to'), h('h3', {}, me.FullName),
    h('p', {}, 'for donating ' + r.DonationType + ' on ' + r.Date + (r.EmergencyFlag === 'Yes' ? ' in response to an emergency appeal' : '') + '.'),
    h('p', {}, 'Donor ID ' + me.DonorID + ' · Certificate ' + r.DonationID), h('p', {}, 'Thank you. You help save lives. – LifeLink')),
    h('button', { class: 'btn', onclick: () => window.print() }, 'Print / save as PDF'));
}
const hlaFields = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'DR1', 'DR2'].map(k => ({ n: 'HLA_' + k, l: 'HLA-' + k, a: { placeholder: 'e.g. 02:01' } }));
async function vDonorHla() {
  const cur = await api('getHLA', { type: 'donor', id: S.id });
  page('HLA typing', panel('Register or update HLA typing',
    form(hlaFields, async o => { await api('saveHLA', Object.assign({ type: 'donor', id: S.id }, o)); toast('HLA typing saved.'); vDonorHla(); }, 'Save HLA typing', cur || {})),
    cur ? panel('Current HLA typing', table(hlaFields.map(f => [f.n, f.l]), [cur])) : '');
}
async function vRewards() {
  const [d, [m]] = await Promise.all([api('getDashboard'), api('getRewards')]);
  page('Rewards & emergency ranking',
    tiles([['Reliability', m.ReliabilityPoints], ['Rare blood', m.RareBloodPoints], ['Safety', m.SafetyPoints], ['Community', m.CommunityPoints], ['Excellence score', m.TotalScore, 'red'], ['Your position', d.myRank + ' of ' + d.totalDonors]]),
    panel('Rank: ' + m.Rank, h('div', { class: 'badges' }, badges({ LifetimeDonations: m.LifetimeDonations, EmergencyDonations: m.EmergencyDonations, RareBloodPoints: m.RareBloodPoints, SafetyPoints: m.SafetyPoints }).map(x => pill(x, 'good'))),
      h('p', { class: 'note' }, 'Excellence = 30% reliability + 20% rare-blood + 30% safety + 20% community. Emergency donors and rare groups rank higher when hospitals search for donors.')),
    panel('Top 10 donors', table([['Name', 'Donor'], ['BloodGroup', 'Group'], ['Donations', 'Donations'], ['Score', 'Excellence'], ['Rank', 'Rank']], d.top10)));
}

/* ---------------- compatibility ---------------- */
async function vCompat() {
  const c = await compat(), out = h('div');
  const f = form([{ n: 'g', l: 'Patient blood group', t: 'select', o: c.groups }, { n: 'c', l: 'Component', t: 'select', o: ['Whole Blood', 'RBC', 'Plasma'] }], async o => {
    const list = c.map[o.c][o.g];
    out.replaceChildren(h('p', {}, 'A ', pill(o.g), ' patient can receive ' + o.c + ' from: ', list.map(g => pill(g, 'good'))), S.role === 'hospital' ? await recommend(o.g, o.c) : '');
  }, 'Check compatibility');
  page('Blood compatibility', panel('', f, out), h('p', { class: 'note' }, 'Reference only. Always confirm with ABO/Rh typing, antibody screen and cross-match. Bombay and Rh Null patients need matching rare units from the blood bank.'));
}
async function recommend(g, comp) {
  const c = await compat(), ok = c.map[comp][g], inv = await api('getInventory'), t = today();
  const rows = inv.filter(x => x.Status === 'Available' && x.ExpiryDate >= t && x.Component === comp && ok.includes(x.BloodGroup))
    .sort((a, b) => (b.BloodGroup === g) - (a.BloodGroup === g) || (a.ExpiryDate < b.ExpiryDate ? -1 : 1));
  return panel('Recommendation from your inventory', rows.length ? table([['UnitID', 'Unit'], ['BloodGroup', 'Group'], ['Quantity', 'Qty'], ['ExpiryDate', 'Expires']], rows) : h('p', { class: 'empty' }, 'No matching units in stock. Request a transfer or call HLA/compatible donors.'),
    h('p', { class: 'note' }, 'Same-group units first, then soonest expiry, to reduce wastage.'));
}

/* ---------------- hospital ---------------- */
const patFields = [
  { n: 'FirstName', l: 'First name' }, { n: 'LastName', l: 'Last name' }, { n: 'DOB', l: 'Date of birth', t: 'date' },
  { n: 'Gender', l: 'Gender', t: 'select', o: ['Female', 'Male', 'Other'] }, { n: 'Nationality', l: 'Nationality', r: false }, { n: 'NationalID', l: 'National ID', r: false },
  { n: 'Mobile', l: 'Mobile', r: false, t: 'tel' }, { n: 'Email', l: 'Email', r: false, t: 'email' }, { n: 'Address', l: 'Address', r: false },
  { n: 'BloodGroup', l: 'Blood group', t: 'select', o: GROUPS }, { n: 'Height', l: 'Height (cm)', r: false, t: 'number' }, { n: 'Weight', l: 'Weight (kg)', r: false, t: 'number' }
];
async function vPatients() {
  const rows = await api('getPatients');
  page('Patients',
    panel('Register patient', form(patFields, async o => { await api('createPatient', o); toast('Patient registered.'); vPatients(); }, 'Register patient')),
    panel('Patient records', table([['PatientID', 'ID'], ['FirstName', 'First'], ['LastName', 'Last'], ['DOB', 'DOB'], ['Gender', 'Gender'], ['BloodGroup', 'Group'], ['Mobile', 'Mobile']], rows, [
      ['Edit', r => modal('Update ' + r.PatientID, form(patFields, async o => { await api('updatePatient', Object.assign({ PatientID: r.PatientID }, o)); $('#dlg').close(); toast('Patient updated.'); vPatients(); }, 'Update', r))],
      ['HLA', async r => { const cur = await api('getHLA', { type: 'patient', id: r.PatientID }); modal('HLA typing – ' + r.PatientID, form(hlaFields, async o => { await api('saveHLA', Object.assign({ type: 'patient', id: r.PatientID }, o)); $('#dlg').close(); toast('Patient HLA saved.'); }, 'Save HLA', cur || {})); }]])));
}
async function vMatch() {
  const pts = await api('getPatients'), out = h('div');
  page('HLA matching', panel('', form([{ n: 'patientId', l: 'Patient', t: 'select', o: opts(pts, 'PatientID', r => r.FirstName + ' ' + r.LastName + ' (' + r.BloodGroup + ')') }], async o => {
    const res = await api('matchHLA', o);
    out.replaceChildren(h('p', { class: 'note' }, 'Score = matching alleles out of 8 (A, B, C, DR). Locked or reaction-flagged donors are excluded.'),
      table([['DonorID', 'Donor'], ['FullName', 'Name'], ['BloodGroup', 'Group'], ['MatchScore', 'Match /8', r => h('div', { class: 'bar' }, h('i', { style: 'width:' + r.MatchScore * 12.5 + '%' }), r.MatchScore + '/8')],
        ['BloodCompatible', 'Blood compatible', r => pill(r.BloodCompatible, r.BloodCompatible === 'Yes' ? 'good' : 'bad')], ['Phone', 'Phone']], res));
  }, 'Find compatible donors'), out));
}
async function vInv() {
  const rows = await api('getInventory'), t = today(), live = rows.filter(x => x.Status === 'Available' && x.ExpiryDate >= t);
  const by = {}; live.forEach(x => by[x.BloodGroup] = (by[x.BloodGroup] || 0) + Number(x.Quantity));
  const max = Math.max(1, ...Object.values(by)), soon = live.filter(x => (new Date(x.ExpiryDate) - new Date(t)) / 864e5 <= 7).length;
  const set = (id, p) => async () => { await api('updateInventory', Object.assign({ UnitID: id }, p)); vInv(); };
  page('Inventory',
    tiles([['Available units', live.reduce((s, x) => s + Number(x.Quantity), 0)], ['Expiring within 7 days', soon, soon ? 'red' : ''], ['Expired, not yet removed', rows.filter(x => ['Available', 'Reserved'].includes(x.Status) && x.ExpiryDate < t).length]]),
    S.role === 'hospital' ? panel('Add units', form([{ n: 'BloodGroup', l: 'Group', t: 'select', o: GROUPS }, { n: 'Component', l: 'Component', t: 'select', o: COMPS }, { n: 'Quantity', l: 'Quantity', t: 'number', a: { min: 1, max: 1000 } }, { n: 'ExpiryDate', l: 'Expiry date', t: 'date', a: { min: t } }],
      async o => { await api('createInventory', o); toast('Units added.'); vInv(); }, 'Add units')) : '',
    panel('Stock by blood group', h('div', { class: 'bars' }, GROUPS.map(g => h('div', { class: 'bar' }, h('span', {}, g), h('i', { style: 'width:' + ((by[g] || 0) / max * 100) + '%' }), h('span', {}, by[g] || 0))))),
    panel('Units (soonest expiry first)', h('button', { class: 'btn', onclick: async () => { const r = await api('removeExpired'); toast(r.removed + ' expired unit(s) removed from stock.'); vInv(); } }, 'Remove expired units'),
      table([['UnitID', 'Unit'], ['BloodGroup', 'Group'], ['Component', 'Component'], ['Quantity', 'Qty'], ['ExpiryDate', 'Expires', r => r.ExpiryDate < t ? pill(r.ExpiryDate, 'bad') : (new Date(r.ExpiryDate) - new Date(t)) / 864e5 <= 7 ? pill(r.ExpiryDate, 'warn') : r.ExpiryDate], ['Status', 'Status']],
        rows.slice().sort((a, b) => a.ExpiryDate < b.ExpiryDate ? -1 : 1), [
          ['Qty', r => { const q = prompt('New quantity for ' + r.UnitID, r.Quantity); if (q !== null) set(r.UnitID, { Quantity: q })().catch(e => toast(e.message, true)); }],
          ['Used', r => set(r.UnitID, { Status: 'Used' })().catch(e => toast(e.message, true)), r => r.Status === 'Available'],
          ['Discard', r => set(r.UnitID, { Status: 'Discarded' })().catch(e => toast(e.message, true)), r => r.Status === 'Available']])));
}
async function vHospDon() {
  const rows = await api('getDonations');
  const set = (id, s) => api('updateDonation', { DonationID: id, Status: s }).then(() => { toast('Donation ' + s.toLowerCase() + '.'); vHospDon(); }).catch(e => toast(e.message, true));
  page('Donations', panel('', table([['DonationID', 'ID'], ['DonorID', 'Donor'], ['Date', 'Date'], ['DonationType', 'Type'], ['Status', 'Status'], ['EmergencyFlag', 'Emergency']], rows.reverse(),
    [['Confirm', r => set(r.DonationID, 'Completed'), r => r.Status === 'Scheduled'], ['Cancel', r => set(r.DonationID, 'Cancelled'), r => r.Status === 'Scheduled']])));
}
async function vReact() {
  const rows = await api('getReactions'), pts = S.role === 'hospital' ? await api('getPatients') : [];
  const sorted = rows.sort((a, b) => SEV.indexOf(b.Severity) - SEV.indexOf(a.Severity));
  page('Transfusion reactions',
    S.role === 'hospital' ? panel('Record reaction', form([
      { n: 'PatientID', l: 'Patient', t: 'select', o: opts(pts, 'PatientID', r => r.FirstName + ' ' + r.LastName) }, { n: 'DonorID', l: 'Donor ID (if known)', r: false },
      { n: 'ReactionDate', l: 'Date', t: 'date', v: today() }, { n: 'Component', l: 'Component', t: 'select', o: COMPS }, { n: 'Units', l: 'Units transfused', t: 'number', a: { min: 1 } },
      { n: 'Duration', l: 'Duration of reaction', r: false, a: { placeholder: 'e.g. 30 min' } }, { n: 'ReactionType', l: 'Reaction type', t: 'select', o: ['Febrile non-haemolytic', 'Allergic', 'Acute haemolytic', 'TRALI', 'TACO', 'Anaphylaxis', 'Other'] },
      { n: 'Severity', l: 'Severity', t: 'select', o: SEV }, { n: 'DoctorNotes', l: 'Doctor notes', t: 'textarea', r: false }],
      async o => { await api('createReaction', o); toast('Reaction recorded. Donor safety score updated.'); vReact(); }, 'Save report')) : '',
    h('p', { class: 'note' }, 'Only mild reactions keep a donor classified Safe. Severe or life-threatening reactions lock the donor until an administrator reviews the case.'),
    panel('Reports (most severe first)', table([['ReactionID', 'ID'], ['PatientID', 'Patient'], ['DonorID', 'Donor'], ['ReactionDate', 'Date'], ['Component', 'Component'], ['ReactionType', 'Type'], ['Severity', 'Severity'], ['DonorSafe', 'Donor', r => pill(r.DonorSafe)], ['DoctorNotes', 'Notes']], sorted)));
}
async function vEmerg() {
  const rows = await api('getEmergencyCases'), pts = S.role === 'hospital' ? await api('getPatients') : [], out = h('div');
  const yn = (n, l) => ({ n, l, t: 'check' });
  page('Emergency cases',
    S.role === 'hospital' ? panel('Priority calculator', form([{ n: 'PatientID', l: 'Patient', t: 'select', o: opts(pts, 'PatientID', r => r.FirstName + ' ' + r.LastName + ' (' + r.BloodGroup + ')') },
      yn('Trauma', 'Trauma'), yn('Bleeding', 'Massive bleeding'), yn('Surgery', 'Surgery'), yn('ICU', 'ICU'), yn('ChildPatient', 'Child patient')], async o => {
      const r = await api('createEmergencyCase', o);
      out.replaceChildren(h('p', {}, 'Priority: ', pill(r.Priority), ' (score ' + r.SeverityScore + '/100)'), await recommend(r.BloodGroup, 'RBC'));
      toast('Case saved.');
    }, 'Calculate & save'), out) : '',
    panel('Cases (highest priority first)', table([['CaseID', 'Case'], ['PatientID', 'Patient'], ['Priority', 'Priority', r => pill(r.Priority)], ['SeverityScore', 'Score'], ['Trauma', 'Trauma'], ['Bleeding', 'Bleeding'], ['Surgery', 'Surgery'], ['ICU', 'ICU'], ['ChildPatient', 'Child'], ['CreatedAt', 'Created']], rows,
      S.role === 'admin' ? [['Remove', async r => { if (confirm('Remove case ' + r.CaseID + '?')) { await api('removeEmergencyCase', { CaseID: r.CaseID }); vEmerg(); } }]] : [])));
}

/* ---------------- admin ---------------- */
async function vAdmDonors() {
  const rows = await api('getDonors');
  const lock = (id, l) => api('setDonorLock', { donorId: id, lock: l }).then(() => { toast(l ? 'Donor locked.' : 'Donor unlocked.'); vAdmDonors(); }).catch(e => toast(e.message, true));
  page('Donors', panel('', table([['DonorID', 'ID'], ['FullName', 'Name'], ['BloodGroup', 'Group'], ['Age', 'Age'], ['Phone', 'Phone'], ['Gmail', 'Gmail'], ['EmiratesID', 'Emirates ID'], ['LifetimeDonations', 'Donations'], ['ExcellenceScore', 'Score'], ['EmergencyLock', 'Locked', r => pill(r.EmergencyLock, r.EmergencyLock === 'Yes' ? 'bad' : 'good')]], rows,
    [['Lock', r => lock(r.DonorID, true), r => r.EmergencyLock !== 'Yes'], ['Unlock', r => lock(r.DonorID, false), r => r.EmergencyLock === 'Yes']])));
}
async function vFraud() {
  const rows = await api('getFraud');
  page('Fraud detection', h('p', { class: 'note' }, 'Checks for duplicate Emirates ID, email and phone, name mismatches with the ID, and donations less than 7 days apart.'),
    panel(rows.length + ' flag(s)', table([['Type', 'Flag'], ['Value', 'Detail'], ['Donors', 'Donor IDs']], rows)));
}
function vExport() {
  const sets = [['Donors', 'getDonors'], ['Hospitals', 'getHospitals'], ['Patients', 'getPatients'], ['Donations', 'getDonations'], ['Inventory', 'getInventory'], ['Reactions', 'getReactions'], ['Emergency cases', 'getEmergencyCases'], ['Rewards', 'getRewards'], ['Audit logs', 'getAuditLogs']];
  page('Export reports', panel('Download CSV', h('div', { class: 'badges' }, sets.map(([l, a]) => h('button', { class: 'btn', onclick: async () => { try { download(l.toLowerCase().replace(/ /g, '-'), await api(a)); } catch (e) { toast(e.message, true); } } }, l)))));
}

if (S) boot(); else showAuth();
