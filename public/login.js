const form = document.getElementById('login-form');
const errorEl = document.getElementById('login-error');

async function checkExistingSession() {
  const response = await fetch('/api/auth/status', { credentials: 'same-origin' });
  if (!response.ok) return;
  const data = await response.json();

  if (!data.authConfigured) {
    const missing = [];
    if (!data.env?.hasUsername) missing.push('AUTH_USERNAME');
    if (!data.env?.hasPassword) missing.push('AUTH_PASSWORD');
    if (!data.env?.hasSecret) missing.push('AUTH_SECRET');
    showError(
      missing.length
        ? `Auth env vars missing on server: ${missing.join(', ')}. Add them in Vercel, then redeploy.`
        : 'Auth is not configured on the server. Add env vars in Vercel, then redeploy.'
    );
    return;
  }

  if (data.authenticated) {
    window.location.href = '/';
  }
}

function showError(message) {
  errorEl.textContent = message;
  errorEl.hidden = !message;
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  showError('');

  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value;

  try {
    const response = await fetch('/api/login', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      showError(data.error || 'Sign in failed');
      return;
    }

    window.location.href = '/';
  } catch {
    showError('Could not reach the analytics server');
  }
});

const params = new URLSearchParams(window.location.search);
if (params.get('error') === 'auth-not-configured') {
  showError('Auth is not configured on the server. Add env vars in Vercel, then redeploy.');
}

checkExistingSession().catch(() => {});
