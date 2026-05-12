/* ============================================================
   script.js — Dispensador de Medicamentos Inteligente
   Toda a lógica da interface: cadastro, edição, exclusão,
   histórico e simulação de status do sistema.
   ============================================================ */

/* -------------------------------------------------------
   1. ESTADO DA APLICAÇÃO
   Aqui ficam todos os dados que a interface usa.
   Em um projeto real, esses dados viriam do ESP32 via API.
   ------------------------------------------------------- */

// Array principal: lista de medicamentos cadastrados
let medications = [];

// Array do histórico de dispensações
let history = [];

// Variável de controle: guarda o id do item sendo editado (null = novo cadastro)
let editingId = null;

// Contador simples para gerar IDs únicos
let idCounter = 1;


/* -------------------------------------------------------
   2. INICIALIZAÇÃO
   Roda assim que a página carrega.
   ------------------------------------------------------- */
document.addEventListener('DOMContentLoaded', () => {
  // Carrega dados salvos no localStorage (memória do navegador)
  loadFromStorage();

  // Renderiza os componentes na tela
  renderMedList();
  renderHistory();
  updateSystemStatus();

  // Simula um status dinâmico do ESP32 (em produção, use fetch/WebSocket)
  simulateEsp32Status();

  // Atualiza "próximo horário" a cada minuto
  setInterval(updateNextSchedule, 60000);
});


/* -------------------------------------------------------
   3. SALVAMENTO NO LOCALSTORAGE
   Permite que os dados persistam mesmo após fechar o navegador.
   ------------------------------------------------------- */

// Salva os arrays no navegador
function saveToStorage() {
  localStorage.setItem('dispensador_meds',    JSON.stringify(medications));
  localStorage.setItem('dispensador_history', JSON.stringify(history));
  localStorage.setItem('dispensador_counter', idCounter);
}

// Recupera os arrays do navegador ao carregar a página
function loadFromStorage() {
  const savedMeds    = localStorage.getItem('dispensador_meds');
  const savedHistory = localStorage.getItem('dispensador_history');
  const savedCounter = localStorage.getItem('dispensador_counter');

  if (savedMeds)    medications = JSON.parse(savedMeds);
  if (savedHistory) history     = JSON.parse(savedHistory);
  if (savedCounter) idCounter   = parseInt(savedCounter);
}


/* -------------------------------------------------------
   4. CADASTRO E EDIÇÃO DE MEDICAMENTOS
   ------------------------------------------------------- */

// Chamada pelo botão "Salvar"
function saveMedication() {
  // Pega os valores dos campos do formulário
  const name = document.getElementById('medName').value.trim();
  const time = document.getElementById('medTime').value;
  const dose = document.getElementById('medDose').value.trim();

  // Validação simples: campos obrigatórios
  if (!name || !time || !dose) {
    showFeedback('Preencha todos os campos antes de salvar.', 'error');
    return;
  }

  if (editingId !== null) {
    // ---- MODO EDIÇÃO: atualiza o item existente ----
    const index = medications.findIndex(m => m.id === editingId);
    if (index !== -1) {
      medications[index].name = name;
      medications[index].time = time;
      medications[index].dose = dose;
    }
    showFeedback('Medicamento atualizado com sucesso!', 'success');
    cancelEdit(); // Limpa o modo de edição

  } else {
    // ---- MODO CADASTRO: cria um novo objeto ----
    const newMed = {
      id:     idCounter++, // ID único incremental
      name:   name,
      time:   time,
      dose:   dose,
      active: true          // todo medicamento começa ativo
    };
    medications.push(newMed);
    showFeedback('Medicamento cadastrado com sucesso!', 'success');
    clearForm();
  }

  // Persiste, re-renderiza e atualiza os contadores
  saveToStorage();
  renderMedList();
  updateSystemStatus();
}

// Preenche o formulário para edição de um item existente
function editMedication(id) {
  const med = medications.find(m => m.id === id);
  if (!med) return;

  // Marca qual item está sendo editado
  editingId = id;

  // Preenche os campos com os dados do medicamento
  document.getElementById('medName').value = med.name;
  document.getElementById('medTime').value = med.time;
  document.getElementById('medDose').value = med.dose;

  // Muda o título e exibe o botão "Cancelar"
  document.getElementById('formTitle').textContent = 'Editar Medicamento';
  document.getElementById('cancelBtn').style.display = 'flex';

  // Rola suavemente até o formulário (útil no celular)
  document.querySelector('.two-col-layout').scrollIntoView({ behavior: 'smooth' });

  clearFeedback();
}

// Cancela o modo de edição e restaura o formulário
function cancelEdit() {
  editingId = null;
  clearForm();
  document.getElementById('formTitle').textContent = 'Cadastrar Medicamento';
  document.getElementById('cancelBtn').style.display = 'none';
  clearFeedback();
}

// Limpa todos os campos do formulário
function clearForm() {
  document.getElementById('medName').value = '';
  document.getElementById('medTime').value = '';
  document.getElementById('medDose').value = '';
}


/* -------------------------------------------------------
   5. EXCLUSÃO DE MEDICAMENTOS (com modal de confirmação)
   ------------------------------------------------------- */

// Guarda qual ID está esperando confirmação de exclusão
let pendingDeleteId = null;

// Abre o modal pedindo confirmação
function deleteMedication(id) {
  const med = medications.find(m => m.id === id);
  if (!med) return;

  pendingDeleteId = id;
  document.getElementById('modalMessage').textContent =
    `Deseja remover "${med.name}" dos medicamentos?`;

  // Configura o botão de confirmação do modal
  document.getElementById('modalConfirmBtn').onclick = confirmDelete;

  // Exibe o modal
  document.getElementById('modalOverlay').classList.add('active');
}

// Executa a exclusão após confirmação
function confirmDelete() {
  medications = medications.filter(m => m.id !== pendingDeleteId);
  pendingDeleteId = null;

  closeModal();
  saveToStorage();
  renderMedList();
  updateSystemStatus();
  showFeedback('Medicamento removido.', 'error');
}

// Fecha o modal sem fazer nada
function closeModal() {
  document.getElementById('modalOverlay').classList.remove('active');
  pendingDeleteId = null;
}

// Fecha o modal ao clicar no fundo escuro
document.getElementById('modalOverlay').addEventListener('click', function(e) {
  if (e.target === this) closeModal();
});


/* -------------------------------------------------------
   6. RENDERIZAÇÃO DA LISTA DE MEDICAMENTOS
   ------------------------------------------------------- */
function renderMedList() {
  const list       = document.getElementById('medList');
  const emptyState = document.getElementById('emptyState');

  // Limpa a lista atual antes de redesenhar
  list.innerHTML = '';

  if (medications.length === 0) {
    // Mostra o aviso de lista vazia
    emptyState.style.display = 'block';
    list.style.display = 'none';
    return;
  }

  // Esconde o aviso e mostra a lista
  emptyState.style.display = 'none';
  list.style.display = 'flex';

  // Ordena por horário antes de exibir
  const sorted = [...medications].sort((a, b) => a.time.localeCompare(b.time));

  sorted.forEach(med => {
    // Pega a primeira letra do nome para o avatar circular
    const initial = med.name.charAt(0).toUpperCase();

    // Formata o horário para exibição (ex: "08:00")
    const displayTime = formatTime(med.time);

    // Cria o elemento <li> com HTML dinâmico
    const li = document.createElement('li');
    li.className = 'med-item';
    li.dataset.id = med.id; // guarda o id no DOM

    li.innerHTML = `
      <!-- Avatar com inicial do nome -->
      <div class="med-avatar">${initial}</div>

      <!-- Informações principais -->
      <div class="med-info">
        <div class="med-name">${escapeHtml(med.name)}</div>
        <div class="med-meta">
          <span><i class="fa-solid fa-clock"></i>${displayTime}</span>
          <span><i class="fa-solid fa-weight-scale"></i>${escapeHtml(med.dose)}</span>
        </div>
      </div>

      <!-- Badge de status -->
      <span class="badge-active">Ativo</span>

      <!-- Botões de ação -->
      <div class="med-actions">
        <button class="btn-icon" title="Editar" onclick="editMedication(${med.id})">
          <i class="fa-solid fa-pen"></i>
        </button>
        <button class="btn-icon delete" title="Excluir" onclick="deleteMedication(${med.id})">
          <i class="fa-solid fa-trash"></i>
        </button>
      </div>
    `;

    list.appendChild(li);
  });
}


/* -------------------------------------------------------
   7. HISTÓRICO DE DISPENSAÇÕES
   ------------------------------------------------------- */

// Adiciona um novo registro no histórico
function addToHistory(medName, dose, status) {
  const now = new Date();
  history.unshift({ // unshift = adiciona no início
    time:    formatDateTime(now),
    medName: medName,
    dose:    dose,
    status:  status // 'entregue' | 'pendente' | 'falha'
  });

  // Limita o histórico a 50 entradas para não sobrecarregar
  if (history.length > 50) history = history.slice(0, 50);

  saveToStorage();
  renderHistory();
}

// Renderiza a tabela de histórico
function renderHistory() {
  const tbody        = document.getElementById('historyBody');
  const emptyDiv     = document.getElementById('historyEmpty');
  const wrapperDiv   = document.getElementById('historyWrapper');

  tbody.innerHTML = '';

  if (history.length === 0) {
    emptyDiv.style.display   = 'block';
    wrapperDiv.style.display = 'none';
    return;
  }

  emptyDiv.style.display   = 'none';
  wrapperDiv.style.display = 'block';

  history.forEach(entry => {
    const tr = document.createElement('tr');

    // Gera o badge correto conforme o status
    const badgeHtml = getBadgeHtml(entry.status);

    tr.innerHTML = `
      <td><span style="font-family:'DM Mono',monospace;font-size:13px">${entry.time}</span></td>
      <td><strong>${escapeHtml(entry.medName)}</strong></td>
      <td>${escapeHtml(entry.dose)}</td>
      <td>${badgeHtml}</td>
    `;

    tbody.appendChild(tr);
  });
}

// Retorna o HTML do badge de acordo com o status
function getBadgeHtml(status) {
  switch (status) {
    case 'entregue':
      return `<span class="badge-entregue"><i class="fa-solid fa-check"></i> Entregue</span>`;
    case 'pendente':
      return `<span class="badge-pendente"><i class="fa-solid fa-clock"></i> Pendente</span>`;
    case 'falha':
      return `<span class="badge-falha"><i class="fa-solid fa-xmark"></i> Falha</span>`;
    default:
      return `<span>${status}</span>`;
  }
}

// Limpa todo o histórico
function clearHistory() {
  if (history.length === 0) return;
  history = [];
  saveToStorage();
  renderHistory();
}


/* -------------------------------------------------------
   8. STATUS DO SISTEMA
   Atualiza os cards de status e o indicador do header.
   ------------------------------------------------------- */
function updateSystemStatus() {
  // Atualiza o total de medicamentos
  const total = medications.length;
  document.getElementById('totalMeds').textContent =
    total === 0 ? '0 cadastrados' :
    total === 1 ? '1 cadastrado'  : `${total} cadastrados`;

  // Calcula o próximo horário programado
  updateNextSchedule();

  // Atualiza a última liberação com base no histórico
  const lastEntry = history.find(h => h.status === 'entregue');
  document.getElementById('lastRelease').textContent =
    lastEntry ? lastEntry.time : '—';
}

// Encontra qual medicamento será liberado a seguir
function updateNextSchedule() {
  if (medications.length === 0) {
    document.getElementById('nextSchedule').textContent = '—';
    return;
  }

  const now      = new Date();
  const nowMins  = now.getHours() * 60 + now.getMinutes(); // minutos desde meia-noite

  // Converte todos os horários para minutos e ordena
  const upcoming = medications
    .map(m => {
      const [h, min] = m.time.split(':').map(Number);
      const totalMin = h * 60 + min;
      // Se o horário já passou hoje, adiciona 1440 (= 24h) para "amanhã"
      const diff = totalMin >= nowMins ? totalMin - nowMins : totalMin + 1440 - nowMins;
      return { name: m.name, time: m.time, diff };
    })
    .sort((a, b) => a.diff - b.diff);

  if (upcoming.length > 0) {
    const next = upcoming[0];
    document.getElementById('nextSchedule').textContent =
      `${formatTime(next.time)} — ${next.name}`;
  }
}


/* -------------------------------------------------------
   9. SIMULAÇÃO DE STATUS DO ESP32
   Em um projeto real, isso seria substituído por
   fetch() ou WebSocket para comunicar com o hardware.
   ------------------------------------------------------- */
function simulateEsp32Status() {
  let online = true;

  // Simula alternância de status a cada 15 segundos (apenas para demonstração)
  setInterval(() => {
    // Probabilidade de ficar offline: 10%
    online = Math.random() > 0.1;
    setEsp32Status(online);
  }, 15000);

  // Estado inicial: online
  setEsp32Status(true);

  // Simula uma dispensação automática a cada 30 segundos (demonstração)
  setInterval(() => {
    if (medications.length > 0 && online) {
      const randomMed = medications[Math.floor(Math.random() * medications.length)];
      const statuses  = ['entregue', 'entregue', 'entregue', 'pendente', 'falha'];
      const randomStatus = statuses[Math.floor(Math.random() * statuses.length)];

      addToHistory(randomMed.name, randomMed.dose, randomStatus);
      updateSystemStatus();
    }
  }, 30000);
}

// Atualiza os elementos visuais relacionados ao status do ESP32
function setEsp32Status(online) {
  const dot        = document.getElementById('headerDot');
  const headerText = document.getElementById('headerStatusText');
  const badge      = document.getElementById('esp32Badge');
  const statusText = document.getElementById('esp32Status');

  if (online) {
    dot.classList.remove('offline');
    headerText.textContent  = 'ESP32 Online';
    badge.className         = 'status-badge badge-online';
    badge.textContent       = 'ONLINE';
    statusText.textContent  = 'Online';
  } else {
    dot.classList.add('offline');
    headerText.textContent  = 'ESP32 Offline';
    badge.className         = 'status-badge badge-offline';
    badge.textContent       = 'OFFLINE';
    statusText.textContent  = 'Offline';
  }
}


/* -------------------------------------------------------
   10. FUNÇÕES AUXILIARES
   ------------------------------------------------------- */

// Formata hora no padrão HH:MM (ex: "08:30")
function formatTime(timeStr) {
  if (!timeStr) return '—';
  const [h, m] = timeStr.split(':');
  return `${h.padStart(2,'0')}:${m.padStart(2,'0')}`;
}

// Formata data e hora completa (ex: "10/05 08:30")
function formatDateTime(date) {
  const day  = String(date.getDate()).padStart(2, '0');
  const mon  = String(date.getMonth() + 1).padStart(2, '0');
  const h    = String(date.getHours()).padStart(2, '0');
  const min  = String(date.getMinutes()).padStart(2, '0');
  return `${day}/${mon} ${h}:${min}`;
}

// Previne XSS: escapa caracteres especiais do HTML
function escapeHtml(str) {
  const map = { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;' };
  return String(str).replace(/[&<>"']/g, c => map[c]);
}

// Exibe uma mensagem de feedback no formulário
function showFeedback(message, type) {
  const el = document.getElementById('formFeedback');
  el.textContent  = message;
  el.className    = `form-feedback ${type}`;

  // Some automaticamente após 3 segundos
  setTimeout(clearFeedback, 3000);
}

// Limpa a mensagem de feedback
function clearFeedback() {
  const el = document.getElementById('formFeedback');
  el.textContent = '';
  el.className   = 'form-feedback';
}