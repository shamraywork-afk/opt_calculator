const state = { orders: [], filterDate: '', authenticated: false, hasAdmin: false, authMode: 'login', monthlyStart: '', monthlyEnd: '', user: null };
const $ = (selector) => document.querySelector(selector);
const today = new Date().toISOString().slice(0, 10);
const defaultMonthlyStart = `${today.slice(0, 7)}-01`;
state.monthlyStart = localStorage.getItem('monthlyStart') || defaultMonthlyStart;
state.monthlyEnd = localStorage.getItem('monthlyEnd') || today;

function formatDate(value) {
  return new Date(`${value}T12:00:00`).toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' });
}

function pluralize(number, one, few, many) {
  const mod10 = number % 10;
  const mod100 = number % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}

function getVisibleOrders() {
  return state.orders.filter((order) => !state.filterDate || order.date === state.filterDate);
}

function getMonthlyStats() {
  const totals = {};
  const monthlyOrders = state.orders.filter((order) => order.date && order.date >= state.monthlyStart && order.date <= state.monthlyEnd);
  monthlyOrders.forEach((order) => {
    const share = Math.ceil(order.count / order.pickers.length);
    order.pickers.forEach((picker) => { totals[picker] = (totals[picker] || 0) + share; });
  });
  return { monthlyOrders, totals };
}

function renderMonthly() {
  const { monthlyOrders, totals } = getMonthlyStats();
  const ranking = Object.entries(totals).sort((first, second) => second[1] - first[1] || first[0].localeCompare(second[0], 'ru'));
  const total = monthlyOrders.reduce((sum, order) => sum + order.count, 0);
  $('#monthlyTitle').textContent = `Итоги за ${formatDateRange(state.monthlyStart, state.monthlyEnd)}`;
  $('#monthlyTotal').textContent = total;
  $('#monthlyBody').innerHTML = ranking.map(([name, count], index) => `<tr><td class="rank">${index + 1}</td><td>${escapeHtml(name)}</td><td>${count}</td></tr>`).join('');
  $('#monthlyEmpty').classList.toggle('hidden', ranking.length > 0);
}

function formatDateRange(start, end) {
  const format = (value) => new Date(`${value}T12:00:00`).toLocaleDateString('ru-RU', { day: '2-digit', month: 'short', year: 'numeric' });
  return `${format(start)} - ${format(end)}`;
}

function render() {
  const visible = getVisibleOrders();
  const total = visible.reduce((sum, order) => sum + order.count, 0);
  const pickerTotals = {};
  visible.forEach((order) => {
    const share = Math.ceil(order.count / order.pickers.length);
    order.pickers.forEach((picker) => { pickerTotals[picker] = (pickerTotals[picker] || 0) + share; });
  });
  $('#totalCount').textContent = total;
  $('#pickerCount').textContent = Object.keys(pickerTotals).length;
  $('#averageCount').textContent = visible.length ? Math.round(total / visible.length) : 0;
  $('#ordersCount').textContent = `${visible.length} ${pluralize(visible.length, 'заказ', 'заказа', 'заказов')}`;
  $('#ordersBody').innerHTML = visible.map((order) => `
    <tr><td>#${escapeHtml(order.number)}<small>${formatDate(order.date)}</small></td>
      <td>${escapeHtml(order.client || 'Без названия')}${order.note ? `<small>${escapeHtml(order.note)}</small>` : ''}</td>
      <td>${order.pickers.map((picker) => `<span class="person">${escapeHtml(picker)}</span>`).join('')}</td>
      <td>${order.count}</td>
      <td>${state.user?.role === 'admin' ? `<button class="delete-btn" title="Изменить" data-edit="${order.id}">✎</button><button class="delete-btn" title="Удалить" data-delete="${order.id}">×</button>` : ''}</td></tr>`).join('');
  $('#emptyState').classList.toggle('hidden', visible.length > 0);
  $('#pickerTotals').innerHTML = Object.entries(pickerTotals).sort((a, b) => b[1] - a[1]).map(([name, count]) => `<span class="picker-total">${escapeHtml(name)} <strong>${count}</strong></span>`).join('');
  renderMonthly();
}

function setAuthState(authenticated) {
  state.authenticated = authenticated;
  $('#loginOpen').classList.toggle('hidden', authenticated);
  $('#cabinetOpen').classList.toggle('hidden', !authenticated);
  $('#orderForm').querySelectorAll('input, textarea, button').forEach((control) => { control.disabled = !authenticated; });
  document.querySelectorAll('.admin-only').forEach((element) => element.classList.toggle('hidden', state.user?.role !== 'admin'));
  if (state.user) {
    $('#profileLogin').textContent = state.user.login;
    $('#profileRole').textContent = state.user.role === 'admin' ? 'Администратор' : 'Сборщик';
    $('#cabinetHint').textContent = state.user.role === 'admin' ? 'Доступны управление пользователями и полное управление заказами.' : 'Вы можете вносить новые данные о собранных заказах.';
    $('#profileAvatar').textContent = state.user.avatar ? '' : state.user.login[0].toUpperCase();
    $('#profileAvatar').style.backgroundImage = state.user.avatar ? `url(${state.user.avatar})` : '';
  }
  render();
}

function closeEditModal() {
  $('#editModal').classList.add('hidden');
  $('#editError').classList.add('hidden');
}

function closeCabinetModal() {
  $('#cabinetModal').classList.add('hidden');
}

function showMonthlyPeriod() {
  $('#monthlyStart').value = state.monthlyStart;
  $('#monthlyEnd').value = state.monthlyEnd;
}

function openEditModal(order) {
  $('#editNumber').value = order.number;
  $('#editDate').value = order.date;
  $('#editCount').value = order.count;
  $('#editClient').value = order.client;
  $('#editPickerOne').value = order.pickers[0] || '';
  $('#editPickerTwo').value = order.pickers[1] || '';
  $('#editNote').value = order.note;
  $('#editModal').dataset.orderId = order.id;
  $('#editModal').classList.remove('hidden');
  $('#editNumber').focus();
}

function escapeHtml(value) { return String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;' }[char])); }

async function loadOrders() {
  const response = await fetch('/api/orders');
  state.orders = await response.json();
  render();
}

async function loadAuth() {
  const response = await fetch('/api/auth');
  const data = await response.json();
  state.hasAdmin = data.has_admin;
  if (data.authenticated || !state.authenticated) {
    state.user = data.user;
    setAuthState(data.authenticated);
  }
}

function setAuthMode(mode) {
  state.authMode = mode;
  const registration = mode === 'register';
  $('#loginTitle').textContent = registration ? 'Первичная регистрация' : 'Вход в систему';
  $('#authHint').textContent = registration ? 'Создайте единственный админ-аккаунт для этого компьютера.' : 'Введите данные администратора.';
  $('#passwordConfirmLabel').classList.toggle('hidden', !registration);
  $('#passwordConfirmInput').required = registration;
  $('#authSubmit').textContent = registration ? 'Создать аккаунт' : 'Войти';
  $('#loginError').classList.add('hidden');
}

function resetForm() {
  $('#orderForm').reset();
  $('#orderId').value = '';
  $('#orderDate').value = today;
  $('#formTitle').textContent = 'Добавить заказ';
  $('#submitText').textContent = 'Добавить в ведомость';
  $('#cancelEdit').classList.add('hidden');
}

$('#orderForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const pickers = [...document.querySelectorAll('.picker')].map((input) => input.value.trim()).filter(Boolean);
  if (pickers.length !== 1 && pickers.length !== 2) return;
  const payload = { id: $('#orderId').value || undefined, number: $('#number').value, date: $('#orderDate').value, client: $('#client').value, note: $('#note').value, count: Number($('#count').value), pickers };
  const response = await fetch('/api/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  if (response.status === 401) { setAuthState(false); alert('Войдите в систему, чтобы изменять заказы.'); return; }
  if (!response.ok) { alert('Не удалось сохранить заказ. Проверьте данные.'); return; }
  resetForm();
  await loadOrders();
});

$('#cancelEdit').addEventListener('click', resetForm);
$('#loginOpen').addEventListener('click', () => { setAuthMode(state.hasAdmin ? 'login' : 'register'); $('#loginModal').classList.remove('hidden'); $('#loginInput').focus(); });
$('#loginClose').addEventListener('click', () => { $('#loginModal').classList.add('hidden'); });
$('#editClose').addEventListener('click', closeEditModal);
$('#editCancel').addEventListener('click', closeEditModal);
$('#editModal').addEventListener('click', (event) => { if (event.target === $('#editModal')) closeEditModal(); });
$('#loginModal').addEventListener('click', (event) => { if (event.target === $('#loginModal')) $('#loginModal').classList.add('hidden'); });
$('#cabinetOpen').addEventListener('click', () => { showMonthlyPeriod(); $('#cabinetModal').classList.remove('hidden'); });
$('#cabinetClose').addEventListener('click', closeCabinetModal);
$('#cabinetModal').addEventListener('click', (event) => { if (event.target === $('#cabinetModal')) closeCabinetModal(); });
$('#avatarInput').addEventListener('change', () => {
  const file = $('#avatarInput').files[0];
  if (!file) return;
  if (file.size > 500000) { alert('Размер аватара не должен превышать 500 КБ.'); return; }
  const reader = new FileReader();
  reader.onload = async () => {
    const response = await fetch('/api/profile', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ avatar: reader.result }) });
    if (!response.ok) { alert('Не удалось сохранить аватар.'); return; }
    state.user = await response.json();
    setAuthState(true);
  };
  reader.readAsDataURL(file);
});
$('#addUserButton').addEventListener('click', async () => {
  const login = $('#newUserLogin').value.trim();
  const password = $('#newUserPassword').value;
  const response = await fetch('/api/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login, password }) });
  if (!response.ok) { $('#userError').textContent = response.status === 409 ? 'Такой пользователь уже существует.' : 'Логин и пароль заполнены некорректно.'; $('#userError').classList.remove('hidden'); return; }
  $('#newUserLogin').value = ''; $('#newUserPassword').value = ''; $('#userError').classList.add('hidden'); alert('Пользователь добавлен.');
});
$('#savePeriod').addEventListener('click', () => {
  const start = $('#monthlyStart').value;
  const end = $('#monthlyEnd').value;
  if (!start || !end || start > end) { alert('Укажите корректный период: начало не может быть позже окончания.'); return; }
  state.monthlyStart = start;
  state.monthlyEnd = end;
  localStorage.setItem('monthlyStart', start);
  localStorage.setItem('monthlyEnd', end);
  closeCabinetModal();
  render();
});
$('#resetPeriod').addEventListener('click', () => {
  state.monthlyStart = defaultMonthlyStart;
  state.monthlyEnd = today;
  localStorage.removeItem('monthlyStart');
  localStorage.removeItem('monthlyEnd');
  showMonthlyPeriod();
  render();
});
document.querySelectorAll('[data-clear-scope]').forEach((button) => button.addEventListener('click', async () => {
  const scope = button.dataset.clearScope;
  const labels = { day: 'выбранный день', month: 'текущий месяц', all: 'все записи' };
  if (!window.confirm(`Удалить ${labels[scope]}? Это действие нельзя отменить.`)) return;
  const period = scope === 'day' ? state.filterDate : today.slice(0, 7);
  const response = await fetch('/api/orders/clear', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scope, period }) });
  if (response.status === 401) { closeCabinetModal(); setAuthState(false); alert('Войдите в систему, чтобы изменять заказы.'); return; }
  if (!response.ok) { alert('Не удалось очистить записи.'); return; }
  closeCabinetModal();
  await loadOrders();
}));
$('#loginForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (state.authMode === 'register' && $('#passwordInput').value !== $('#passwordConfirmInput').value) { $('#loginError').textContent = 'Пароли не совпадают'; $('#loginError').classList.remove('hidden'); return; }
  const response = await fetch(state.authMode === 'register' ? '/api/register' : '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login: $('#loginInput').value, password: $('#passwordInput').value }) });
  if (!response.ok) { $('#loginError').textContent = state.authMode === 'register' ? 'Не удалось создать аккаунт' : 'Неверный логин или пароль'; $('#loginError').classList.remove('hidden'); return; }
  state.hasAdmin = true; state.user = await response.json(); $('#loginForm').reset(); $('#loginError').classList.add('hidden'); $('#loginModal').classList.add('hidden'); setAuthState(true);
});
$('#logoutBtn').addEventListener('click', async () => { await fetch('/api/logout', { method: 'POST' }); closeCabinetModal(); resetForm(); state.user = null; setAuthState(false); });
$('#filterDate').addEventListener('change', (event) => { state.filterDate = event.target.value; render(); });
document.querySelectorAll('.view-tab').forEach((tab) => tab.addEventListener('click', () => {
  document.querySelectorAll('.view-tab').forEach((item) => item.classList.toggle('active', item === tab));
  document.querySelectorAll('[data-panel]').forEach((panel) => panel.classList.toggle('hidden', panel.dataset.panel !== tab.dataset.view));
}));
$('#ordersBody').addEventListener('click', async (event) => {
  const deleteButton = event.target.closest('[data-delete]');
  const editButton = event.target.closest('[data-edit]');
  if (deleteButton) {
    const response = await fetch(`/api/orders/${deleteButton.dataset.delete}`, { method: 'DELETE' });
    if (response.status === 401) { setAuthState(false); alert('Войдите в систему, чтобы изменять заказы.'); return; }
    await loadOrders();
  }
  if (editButton) {
    const order = state.orders.find((item) => item.id === editButton.dataset.edit);
    if (!order) return;
    openEditModal(order);
  }
});

$('#editForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const pickers = [...document.querySelectorAll('.edit-picker')].map((input) => input.value.trim()).filter(Boolean);
  if (pickers.length !== 1 && pickers.length !== 2) return;
  const payload = { id: $('#editModal').dataset.orderId, number: $('#editNumber').value, date: $('#editDate').value, client: $('#editClient').value, note: $('#editNote').value, count: Number($('#editCount').value), pickers };
  const response = await fetch('/api/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  if (response.status === 401) { closeEditModal(); setAuthState(false); alert('Войдите в систему, чтобы изменять заказы.'); return; }
  if (!response.ok) { $('#editError').textContent = 'Не удалось сохранить изменения. Проверьте данные.'; $('#editError').classList.remove('hidden'); return; }
  closeEditModal();
  await loadOrders();
});

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  $('#loginModal').classList.add('hidden');
  closeEditModal();
  closeCabinetModal();
});

$('#exportBtn').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(state.orders, null, 2)], { type: 'application/json' });
  const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `opt-orders-${today}.json`; link.click(); URL.revokeObjectURL(link.href);
});

$('#todayLabel').textContent = new Date().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });
$('#orderDate').value = today; $('#filterDate').value = today; state.filterDate = today; loadAuth(); loadOrders();
