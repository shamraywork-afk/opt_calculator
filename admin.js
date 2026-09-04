const $ = (selector) => document.querySelector(selector);

async function loadAdminState() {
  const response = await fetch('/api/auth');
  const data = await response.json();
  const registration = !data.has_admin;
  $('#adminTitle').textContent = registration ? 'Первичная регистрация' : 'Вход администратора';
  $('#adminHint').textContent = registration ? 'Создайте единственный админ-аккаунт для этого компьютера.' : 'Введите данные администратора для продолжения.';
  $('#adminPasswordConfirmLabel').classList.toggle('hidden', !registration);
  $('#adminPasswordConfirm').required = registration;
  $('#adminSubmit').textContent = registration ? 'Создать аккаунт' : 'Войти';
  $('#adminForm').dataset.mode = registration ? 'register' : 'login';
}

$('#adminForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const registration = $('#adminForm').dataset.mode === 'register';
  if (registration && $('#adminPassword').value !== $('#adminPasswordConfirm').value) {
    $('#adminError').textContent = 'Пароли не совпадают';
    $('#adminError').classList.remove('hidden');
    return;
  }
  const response = await fetch(registration ? '/api/register' : '/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: $('#adminLogin').value, password: $('#adminPassword').value, admin_only: true })
  });
  if (!response.ok) {
    $('#adminError').textContent = registration ? 'Не удалось создать аккаунт' : 'Неверный логин или пароль';
    $('#adminError').classList.remove('hidden');
    return;
  }
  window.location.href = '/';
});

loadAdminState();
