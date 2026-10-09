/* =========================================================
   TunTon: UI + Google Sign-In (Google Identity Services)
   ========================================================= */

// 1) Paste your OAuth Web Client ID here (Google Cloud Console > APIs & Services > Credentials)
const GOOGLE_CLIENT_ID = 'YOUR_CLIENT_ID.apps.googleusercontent.com';

const SESSION_KEY = 'tunton_session';
const USERS_KEY = 'tunton_users';

/* ---------- Mobile menu ---------- */
const toggle = document.querySelector('.nav-toggle');
const menu = document.getElementById('menu');

toggle.addEventListener('click', () => {
  const open = menu.classList.toggle('open');
  toggle.setAttribute('aria-expanded', open);
});
const closeMenu = () => {
  menu.classList.remove('open');
  toggle.setAttribute('aria-expanded', 'false');
};
menu.querySelectorAll('a').forEach(a => a.addEventListener('click', closeMenu));

/* ---------- Header shadow + active section ---------- */
const header = document.getElementById('header');
window.addEventListener('scroll', () => header.classList.toggle('scrolled', window.scrollY > 10), { passive: true });

const links = menu.querySelectorAll(':scope > a[href^="#"]');
const observer = new IntersectionObserver(entries => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      links.forEach(a => a.classList.toggle('active', a.getAttribute('href') === '#' + entry.target.id));
    }
  });
}, { rootMargin: '-45% 0px -50% 0px' });
document.querySelectorAll('main section[id]').forEach(s => observer.observe(s));

document.getElementById('year').textContent = new Date().getFullYear();

/* ---------- Hero stacked cards ---------- */
const stackCards = [...document.querySelectorAll('.stack-card')];
if (stackCards.length > 1 && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
  let front = 0;
  setInterval(() => {
    front = (front + 1) % stackCards.length;
    stackCards.forEach((card, i) => {
      card.dataset.pos = (i - front + stackCards.length) % stackCards.length;
    });
  }, 3500);
}

/* =========================================================
   Authentication
   ========================================================= */
const dialog = document.getElementById('auth-dialog');
const authMsg = document.getElementById('auth-message');
const tabs = dialog.querySelectorAll('.tab');
const panels = dialog.querySelectorAll('.tab-panel');
const authOut = document.querySelector('.auth-out');
const authIn = document.querySelector('.auth-in');

let activeTab = 'login';
let pendingTarget = null; // where to scroll after login

const read = (key, fallback) => {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
};
const write = (key, value) => localStorage.setItem(key, JSON.stringify(value));

/* Decode the Google ID token (JWT) payload */
function decodeJwt(token) {
  const base64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
  const json = decodeURIComponent(atob(base64).split('').map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join(''));
  return JSON.parse(json);
}

function showMessage(text, isError = false) {
  authMsg.textContent = text;
  authMsg.classList.toggle('error', isError);
}

function setTab(name) {
  activeTab = name;
  tabs.forEach(t => t.setAttribute('aria-selected', t.dataset.tab === name));
  panels.forEach(p => (p.hidden = p.dataset.panel !== name));
  showMessage('');
}

function openAuth(tab = 'login') {
  setTab(tab);
  if (GOOGLE_CLIENT_ID.startsWith('YOUR_CLIENT_ID')) showMessage('Sir hindi pa po namin naiimplement hehehehe. Stay tuned for more updates!', true);
  closeMenu();
  if (!dialog.open) dialog.showModal();
}

function closeAuth() { if (dialog.open) dialog.close(); }

/* Update the navigation for the current session */
function renderSession() {
  const user = read(SESSION_KEY, null);
  authOut.hidden = !!user;
  authIn.hidden = !user;
  if (user) {
    document.getElementById('user-name').textContent = user.given_name || user.name;
    const avatar = document.getElementById('user-avatar');
    avatar.src = user.picture || '';
    avatar.alt = user.name;
  }
}

/* Called by Google after the user picks an account */
function handleCredential(response) {
  let profile;
  try {
    profile = decodeJwt(response.credential);
  } catch {
    showMessage('Sign-in failed. Please try again.', true);
    return;
  }

  const users = read(USERS_KEY, {});
  const known = !!users[profile.sub];

  if (activeTab === 'login' && !known) {
    setTab('signup');
    showMessage('No TunTon account found for this Google account. Sign up to continue.', true);
    return;
  }

  if (!known) {
    users[profile.sub] = { created: Date.now() };
    write(USERS_KEY, users);
  }

  write(SESSION_KEY, {
    sub: profile.sub,
    name: profile.name,
    given_name: profile.given_name,
    email: profile.email,
    picture: profile.picture
  });

  closeAuth();
  renderSession();
  if (pendingTarget) {
    document.querySelector(pendingTarget)?.scrollIntoView({ behavior: 'smooth' });
    pendingTarget = null;
  }
}

function logout() {
  localStorage.removeItem(SESSION_KEY);
  if (window.google?.accounts?.id) google.accounts.id.disableAutoSelect();
  renderSession();
}

/* Render the official Google buttons */
function initGoogle() {
  if (!window.google?.accounts?.id) return;
  if (GOOGLE_CLIENT_ID.startsWith('YOUR_CLIENT_ID')) {
    return;
  }
  google.accounts.id.initialize({ client_id: GOOGLE_CLIENT_ID, callback: handleCredential });
  google.accounts.id.renderButton(document.getElementById('google-login'),
    { theme: 'outline', size: 'large', shape: 'pill', text: 'signin_with', width: 280 });
  google.accounts.id.renderButton(document.getElementById('google-signup'),
    { theme: 'filled_blue', size: 'large', shape: 'pill', text: 'signup_with', width: 280 });
}

/* ---------- Events ---------- */
document.querySelectorAll('[data-open-auth]').forEach(btn =>
  btn.addEventListener('click', () => openAuth(btn.dataset.openAuth)));

tabs.forEach(t => t.addEventListener('click', () => setTab(t.dataset.tab)));
document.getElementById('auth-close').addEventListener('click', closeAuth);
dialog.addEventListener('click', e => { if (e.target === dialog) closeAuth(); });
document.getElementById('logout-btn').addEventListener('click', logout);

/* Buttons that need an account (report lost / found pet) */
document.querySelectorAll('[data-requires-auth]').forEach(btn =>
  btn.addEventListener('click', () => {
    const target = btn.dataset.target;
    if (read(SESSION_KEY, null)) {
      document.querySelector(target)?.scrollIntoView({ behavior: 'smooth' });
    } else {
      pendingTarget = target;
      openAuth('login');
      showMessage('Please log in or sign up to file a report.');
    }
  }));

renderSession();
window.addEventListener('load', initGoogle);