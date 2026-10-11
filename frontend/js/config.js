/* Shared settings, loaded before every other script.
   Same origin as the Express server (npm start): leave API_BASE as '/api'.
   Opened with VS Code Live Server (port 5500) instead? Use the full URL:
     API_BASE: 'http://localhost:3000/api'
   and add the Live Server origin to ALLOWED_ORIGINS in .env. */
window.TUNTON = { API_BASE: '/api' };
