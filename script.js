/* ============================================================
   script.js — Dispensador de Medicamentos Inteligente
   Integração com Firebase Realtime Database
   ============================================================

   ESTRUTURA NO FIREBASE (JSON):
   dispensador/
   ├── medicamentos/
   │   ├── -abc123/
   │   │   ├── name: "Paracetamol 500mg"
   │   │   ├── time: "08:00"
   │   │   ├── dose: "1 comprimido"
   │   │   └── active: true
   │   └── ...
   ├── historico/
   │   ├── -xyz789/
   │   │   ├── time: "10/05 08:00"
   │   │   ├── medName: "Paracetamol"
   │   │   ├── dose: "1 comprimido"
   │   │   └── status: "entregue"
   │   └── ...
   └── sistema/
       ├── esp32_online: true
       ├── ultima_liberacao: "10/05 08:00"
       └── last_seen: 1715000000000   (timestamp Unix)
   ============================================================ */


/* -------------------------------------------------------
   1. CONFIGURAÇÃO DO FIREBASE
   ⚠️  SUBSTITUA PELOS DADOS DO SEU PROJETO!
   Console: https://console.firebase.google.com/
   Projeto → Configurações → Seus apps → SDK config
   ------------------------------------------------------- */
// Import the functions you need from the SDKs you need

// Configuração Firebase
const firebaseConfig = {
  apiKey: "AIzaSyAh-RowIR80XdGb7MJk35dt8KfIRpMP95E",
  authDomain: "dispensador-medicamentos-3439f.firebaseapp.com",
  databaseURL: "https://dispensador-medicamentos-3439f-default-rtdb.firebaseio.com/",
  projectId: "dispensador-medicamentos-3439f",
  storageBucket: "dispensador-medicamentos-3439f.firebasestorage.app",
  messagingSenderId: "480184837741",
  appId: "1:480184837741:web:acf19da69e2faf7f898164"
};

// Inicializa Firebase
firebase.initializeApp(firebaseConfig);

// Banco
const db = firebase.database();

// Atalhos para os nós principais do banco
const medsRef     = db.ref('dispensador/medicamentos');
const historyRef  = db.ref('dispensador/historico');
const sistemaRef  = db.ref('dispensador/sistema');

// Cache local dos medicamentos (recebido do Firebase)
let medicationsCache = {};

// ID do item sendo editado (null = novo cadastro)
let editingId = null;

// ID aguardando confirmação de exclusão
let pendingDeleteId = null;


/* -------------------------------------------------------
   3. INICIALIZAÇÃO DA INTERFACE
   Roda quando a página termina de carregar.
   ------------------------------------------------------- */
document.addEventListener('DOMContentLoaded', () => {
  initFirebaseListeners();   // Escuta mudanças em tempo real
  updateNextScheduleLoop();  // Atualiza "próximo horário" periodicamente
});


/* -------------------------------------------------------
   4. LISTENERS FIREBASE — TEMPO REAL
   Cada listener fica "ouvindo" o banco continuamente.
   Qualquer mudança (pelo ESP32 ou pela web) é recebida
   instantaneamente via WebSocket.
   ------------------------------------------------------- */
function initFirebaseListeners() {

  // ── 4a. Listener de conexão com o Firebase ──────────────
  // O nó especial ".info/connected" indica se há conexão ativa
  db.ref('.info/connected').on('value', (snap) => {
    const connected = snap.val() === true;
    setFirebaseStatus(connected);
  });


  // ── 4b. Listener de medicamentos ────────────────────────
  // Dispara quando qualquer medicamento é adicionado, alterado ou removido
  medsRef.on('value', (snapshot) => {
    // snapshot.val() retorna todos os medicamentos como objeto JSON
    medicationsCache = snapshot.val() || {};
    renderMedList();
    updateNextSchedule();
    updateTotalBadge();

    // Acende o ponto "Tempo Real" da seção
    blinkRealtimeDot('realtimeDot');
  });


  // ── 4c. Listener de histórico ───────────────────────────
  // Limita aos últimos 50 registros (orderByChild + limitToLast)
  historyRef.orderByChild('timestamp').limitToLast(50).on('value', (snapshot) => {
    renderHistory(snapshot.val() || {});
    blinkRealtimeDot('historyDot');
  });


  // ── 4d. Listener de status do sistema ───────────────────
  // O ESP32 atualiza este nó periodicamente (heartbeat)
  sistemaRef.on('value', (snapshot) => {
    const data = snapshot.val();
    if (!data) return;

    // Status do ESP32
    setEsp32Status(data.esp32_online === true);

    // Última liberação
    if (data.ultima_liberacao) {
      document.getElementById('lastRelease').textContent = data.ultima_liberacao;
    }
  });


  // ── 4e. Detecta timeout do ESP32 (sem heartbeat) ────────
  // Se o ESP32 não atualizar last_seen em 15s, considera offline
  setInterval(checkEsp32Heartbeat, 10000);
}


/* -------------------------------------------------------
   5. SALVAR MEDICAMENTO NO FIREBASE
   ------------------------------------------------------- */
function saveMedication() {
  const name = document.getElementById('medName').value.trim();
  const time = document.getElementById('medTime').value;
  const dose = document.getElementById('medDose').value.trim();

  if (!name || !time || !dose) {
    showFeedback('Preencha todos os campos antes de salvar.', 'error');
    return;
  }

  const medData = {
    name:   name,
    time:   time,
    dose:   dose,
    active: true
  };

  if (editingId) {
    // ── EDIÇÃO: atualiza o nó existente pelo ID (key do Firebase) ──
    medsRef.child(editingId).update(medData)
      .then(() => {
        showFeedback('Medicamento atualizado no Firebase!', 'success');
        cancelEdit();
      })
      .catch(err => showFeedback('Erro ao atualizar: ' + err.message, 'error'));

  } else {
    // ── CADASTRO: push() gera uma key única automaticamente ──
    // Ex: "-NxAbc123XYZ" — gerada pelo Firebase de forma ordenada
    medsRef.push(medData)
      .then(() => {
        showFeedback('Medicamento salvo no Firebase!', 'success');
        clearForm();
      })
      .catch(err => showFeedback('Erro ao salvar: ' + err.message, 'error'));
  }
}


/* -------------------------------------------------------
   6. EDITAR MEDICAMENTO
   ------------------------------------------------------- */
function editMedication(key) {
  const med = medicationsCache[key];
  if (!med) return;

  editingId = key;

  document.getElementById('medName').value = med.name;
  document.getElementById('medTime').value = med.time;
  document.getElementById('medDose').value = med.dose;

  document.getElementById('formTitle').textContent = 'Editar Medicamento';
  document.getElementById('cancelBtn').style.display = 'flex';
  document.getElementById('saveBtn').innerHTML =
    '<i class="fa-solid fa-floppy-disk"></i> Editar';

  document.querySelector('.two-col-layout').scrollIntoView({ behavior: 'smooth' });
  clearFeedback();
}

function cancelEdit() {
  editingId = null;
  clearForm();
  document.getElementById('formTitle').textContent = 'Cadastrar Medicamento';
  document.getElementById('cancelBtn').style.display = 'none';
  document.getElementById('saveBtn').innerHTML =
    '<i class="fa-solid fa-floppy-disk"></i> Salvar';
  clearFeedback();
}

function clearForm() {
  document.getElementById('medName').value = '';
  document.getElementById('medTime').value = '';
  document.getElementById('medDose').value = '';
}


/* -------------------------------------------------------
   7. EXCLUIR MEDICAMENTO
   ------------------------------------------------------- */
function deleteMedication(key) {
  const med = medicationsCache[key];
  if (!med) return;

  pendingDeleteId = key;
  document.getElementById('modalMessage').textContent =
    `Deseja remover "${med.name}" do Firebase?`;
  document.getElementById('modalConfirmBtn').onclick = confirmDelete;
  document.getElementById('modalOverlay').classList.add('active');
}

function confirmDelete() {
  // remove() apaga o nó do Firebase — o listener 'value' atualiza a tela automaticamente
  medsRef.child(pendingDeleteId).remove()
    .then(() => { showFeedback('Medicamento removido.', 'error'); })
    .catch(err => showFeedback('Erro ao remover: ' + err.message, 'error'));

  pendingDeleteId = null;
  closeModal();
}

function closeModal() {
  document.getElementById('modalOverlay').classList.remove('active');
  pendingDeleteId = null;
}

document.getElementById('modalOverlay').addEventListener('click', function(e) {
  if (e.target === this) closeModal();
});


/* -------------------------------------------------------
   8. RENDERIZAÇÃO DA LISTA DE MEDICAMENTOS
   ------------------------------------------------------- */
function renderMedList() {
  const list       = document.getElementById('medList');
  const emptyState = document.getElementById('emptyState');
  list.innerHTML   = '';

  const keys = Object.keys(medicationsCache);

  if (keys.length === 0) {
    emptyState.style.display = 'block';
    list.style.display       = 'none';
    return;
  }

  emptyState.style.display = 'none';
  list.style.display       = 'flex';

  // Converte objeto → array e ordena por horário
  const sorted = keys
    .map(k => ({ key: k, ...medicationsCache[k] }))
    .sort((a, b) => a.time.localeCompare(b.time));

  sorted.forEach(med => {
    const initial     = med.name.charAt(0).toUpperCase();
    const displayTime = formatTime(med.time);
    const li          = document.createElement('li');
    li.className      = 'med-item';

    li.innerHTML = `
      <div class="med-avatar">${initial}</div>
      <div class="med-info">
        <div class="med-name">${escapeHtml(med.name)}</div>
        <div class="med-meta">
          <span><i class="fa-solid fa-clock"></i>${displayTime}</span>
          <span><i class="fa-solid fa-weight-scale"></i>${escapeHtml(med.dose)}</span>
        </div>
      </div>
      <span class="badge-active">Ativo</span>
      <div class="med-actions">
        <button class="btn-icon" title="Editar" onclick="editMedication('${med.key}')">
          <i class="fa-solid fa-pen"></i>
        </button>
        <button class="btn-icon delete" title="Excluir" onclick="deleteMedication('${med.key}')">
          <i class="fa-solid fa-trash"></i>
        </button>
      </div>
    `;

    list.appendChild(li);
  });
}


/* -------------------------------------------------------
   9. HISTÓRICO — recebido do Firebase em tempo real
   O ESP32 grava cada dispensação com:
   historyRef.push({ medName, dose, status, timestamp, time })
   ------------------------------------------------------- */
function renderHistory(data) {
  const tbody      = document.getElementById('historyBody');
  const emptyDiv   = document.getElementById('historyEmpty');
  const wrapperDiv = document.getElementById('historyWrapper');
  tbody.innerHTML  = '';

  const entries = Object.values(data);

  if (entries.length === 0) {
    emptyDiv.style.display   = 'block';
    wrapperDiv.style.display = 'none';
    return;
  }

  emptyDiv.style.display   = 'none';
  wrapperDiv.style.display = 'block';

  // Ordena do mais recente para o mais antigo
  entries.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

  entries.forEach(entry => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><span style="font-family:'DM Mono',monospace;font-size:13px">${entry.time || '—'}</span></td>
      <td><strong>${escapeHtml(entry.medName || '—')}</strong></td>
      <td>${escapeHtml(entry.dose || '—')}</td>
      <td>${getBadgeHtml(entry.status)}</td>
    `;
    tbody.appendChild(tr);
  });
}

// Limpa o nó de histórico no Firebase
function clearHistory() {
  historyRef.remove()
    .then(() => showFeedback('Histórico limpo no Firebase.', 'success'))
    .catch(err => showFeedback('Erro: ' + err.message, 'error'));
}


/* -------------------------------------------------------
   10. STATUS DO SISTEMA
   ------------------------------------------------------- */

// Atualiza o status do Firebase na tela
function setFirebaseStatus(connected) {
  const el    = document.getElementById('firebaseStatus');
  const badge = document.getElementById('firebaseBadge');

  if (connected) {
    el.textContent    = 'Conectado';
    badge.textContent = 'OK';
    badge.className   = 'status-badge badge-online';
  } else {
    el.textContent    = 'Desconectado';
    badge.textContent = 'ERRO';
    badge.className   = 'status-badge badge-offline';
  }
}

// Atualiza o status do ESP32 na tela
function setEsp32Status(online) {
  const dot        = document.getElementById('headerDot');
  const headerText = document.getElementById('headerStatusText');
  const badge      = document.getElementById('esp32Badge');
  const statusText = document.getElementById('esp32Status');

  if (online) {
    dot.classList.remove('offline');
    headerText.textContent = 'ESP32 Online';
    badge.className        = 'status-badge badge-online';
    badge.textContent      = 'ONLINE';
    statusText.textContent = 'Online';
  } else {
    dot.classList.add('offline');
    headerText.textContent = 'ESP32 Offline';
    badge.className        = 'status-badge badge-offline';
    badge.textContent      = 'OFFLINE';
    statusText.textContent = 'Offline';
  }
}

// Verifica se o ESP32 enviou heartbeat recentemente (últimos 20 segundos)
function checkEsp32Heartbeat() {
  sistemaRef.child('last_seen').once('value', (snap) => {
    const lastSeen = snap.val();
    if (!lastSeen) return;
    const agora    = Date.now();
    const diff     = agora - lastSeen;        // ms desde o último ping
    const offline  = diff > 20000;            // > 20 segundos = offline
    setEsp32Status(!offline);
  });
}

// Calcula e exibe o próximo medicamento a ser liberado
function updateNextSchedule() {
  const keys = Object.keys(medicationsCache);
  if (keys.length === 0) {
    document.getElementById('nextSchedule').textContent = '—';
    return;
  }

  const now     = new Date();
  const nowMins = now.getHours() * 60 + now.getMinutes();

  const upcoming = keys
    .map(k => {
      const med       = medicationsCache[k];
      const [h, min]  = med.time.split(':').map(Number);
      const totalMin  = h * 60 + min;
      const diff      = totalMin >= nowMins
        ? totalMin - nowMins
        : totalMin + 1440 - nowMins;
      return { name: med.name, time: med.time, diff };
    })
    .sort((a, b) => a.diff - b.diff);

  if (upcoming.length > 0) {
    const next = upcoming[0];
    document.getElementById('nextSchedule').textContent =
      `${formatTime(next.time)} — ${next.name}`;
  }
}

function updateNextScheduleLoop() {
  updateNextSchedule();
  setInterval(updateNextSchedule, 60000);
}

function updateTotalBadge() {
  // Sem elemento no novo HTML, mas mantemos para compatibilidade
}

// Pisca o ponto "Tempo Real" brevemente para sinalizar atualização
function blinkRealtimeDot(id) {
  const dot = document.getElementById(id);
  if (!dot) return;
  dot.style.opacity = '0.2';
  setTimeout(() => { dot.style.opacity = '1'; }, 300);
}


/* -------------------------------------------------------
   11. FUNÇÕES AUXILIARES
   ------------------------------------------------------- */
function getBadgeHtml(status) {
  switch (status) {
    case 'entregue':
      return `<span class="badge-entregue"><i class="fa-solid fa-check"></i> Entregue</span>`;
    case 'pendente':
      return `<span class="badge-pendente"><i class="fa-solid fa-clock"></i> Pendente</span>`;
    case 'falha':
      return `<span class="badge-falha"><i class="fa-solid fa-xmark"></i> Falha</span>`;
    default:
      return `<span>${status || '—'}</span>`;
  }
}

function formatTime(timeStr) {
  if (!timeStr) return '—';
  const [h, m] = timeStr.split(':');
  return `${h.padStart(2,'0')}:${m.padStart(2,'0')}`;
}

function formatDateTime(date) {
  const d   = String(date.getDate()).padStart(2, '0');
  const mo  = String(date.getMonth() + 1).padStart(2, '0');
  const h   = String(date.getHours()).padStart(2, '0');
  const mi  = String(date.getMinutes()).padStart(2, '0');
  return `${d}/${mo} ${h}:${mi}`;
}

function escapeHtml(str) {
  const map = { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;' };
  return String(str).replace(/[&<>"']/g, c => map[c]);
}

function showFeedback(msg, type) {
  const el     = document.getElementById('formFeedback');
  el.textContent = msg;
  el.className   = `form-feedback ${type}`;
  setTimeout(clearFeedback, 3500);
}

function clearFeedback() {
  const el   = document.getElementById('formFeedback');
  el.textContent = '';
  el.className   = 'form-feedback';
}