/* E-mail notifications: (1) a new report strongly matches yours, (2) someone sent a claim on your report,
   (3) an admin suspended your account.
   Match e-mails: when someone creates a report and it STRONGLY matches (score 80+) another user's report, the OWNER of that other report gets an e-mail.

   How it works (outbox pattern):
     1. matchRunner calls queueMatchEmail() inside the same transaction that stores the match. The e-mail is only a
        row in email_notifications (status 'pending'), so nothing slow happens during the request, and if the
        transaction rolls back the e-mail disappears with it.
     2. startWorker() wakes up every EMAIL_BATCH_INTERVAL_SECONDS and sends at most EMAIL_BATCH_SIZE pending e-mails
        (one at a time, EMAIL_SEND_DELAY_MS apart). Whatever is left waits for the next batch, so a burst of reports
        never blows through the mail provider's rate limit.
     3. EMAIL_DAILY_LIMIT (0 = no limit) stops sending for the day once reached. Unsent rows stay pending and go
        out the next day, so nothing is lost.
   One e-mail per (owner, lost report, found report) pair ever (unique key), so editing a report never re-sends. */
const fs = require('fs');
const path = require('path');
const pool = require('../db/pool');

const num = (v, d) => (Number.isFinite(Number(v)) && Number(v) >= 0 && v !== '' && v != null ? Number(v) : d);
const CFG = {
  batchSize: Math.max(1, num(process.env.EMAIL_BATCH_SIZE, 10)),
  intervalMs: Math.max(1, num(process.env.EMAIL_BATCH_INTERVAL_SECONDS, 60)) * 1000,
  sendDelayMs: num(process.env.EMAIL_SEND_DELAY_MS, 1000),
  dailyLimit: num(process.env.EMAIL_DAILY_LIMIT, 0),
  maxAttempts: Math.max(1, num(process.env.EMAIL_MAX_ATTEMPTS, 3)),
  minScore: num(process.env.EMAIL_MIN_SCORE, 80)   // only matches at or above this are e-mailed (80 = "Strong")
};

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cap = s => String(s || '').replace(/^./, c => c.toUpperCase());
const baseUrl = () => String(process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/+$/, '');
const firstName = full => String(full || '').trim().split(/\s+/)[0] || 'there';

/* =====================================================================
   EMAIL TEMPLATES: edit this block to change what the e-mails say and look like.
   There are three e-mails, EMAIL.match, EMAIL.claim and EMAIL.suspension. Placeholders in {braces} are filled in for each e-mail.
     both:   {ownerName} first name of the person being e-mailed   {petName} name of THEIR report's pet
             {mine} "lost" or "found" (their report's type)
     match:  {theirs} type of the new report   {label} Strong / Likely / ...   {labelLower}   {percent} score, rounded
     claim:  {claimantName} first name of the person who sent the claim   {claimMeaning} what the claim says
     suspension: {ownerName} first name of the suspended user (no pet placeholders), {reason} the admin's reason
   Put **double asterisks** around words to make them bold.
   The sender name/address is not here: it is MAIL_FROM in .env.
   ===================================================================== */
const EMAIL_STYLE = {   // look of the HTML version (inline styles, because e-mail apps ignore stylesheets)
  font: "Georgia, 'Times New Roman', serif",
  pageBg: '#eef3ee', cardBg: '#ffffff', width: 600, radius: 14,
  headerFrom: '#0a4f2e', headerTo: '#2fa05a',      // header banner gradient (TunTon greens)
  headerText: '#ffffff', headerSubtext: '#d9f2c2',
  text: '#222222', heading: '#0a4f2e', muted: '#5b7a6c', faint: '#8a9a92',
  buttonFrom: '#0a4f2e', buttonTo: '#0f6b3f', buttonText: '#ffffff',
  boxBg: '#f6fcf0', boxBorder: '#2fa05a',          // the details box
  /* Logo shown in the header. It is attached to each e-mail (so it shows even on localhost); if the file is missing
     the word "TunTon" is shown instead. */
  logoFile: path.join(__dirname, '..', '..', 'frontend', 'assets', 'logo', 'tunton-white.png'), logoWidth: 150
};
const LOGO_CID = 'tunton-logo';
const FOOTER = 'You received this because you have an active report on TunTon.';
const ACCOUNT_FOOTER = 'You received this because you have an account on TunTon.';

const EMAIL = {
  /* 1. A new report strongly matches one of yours. */
  match: {
    subject:  '{label} match for your {mine} pet report "{petName}"',
    title:    '{label} match found',
    subtitle: 'For your {mine} pet "{petName}"',
    greeting: 'Hi {ownerName},',
    intro:    'A new {theirs} report was just posted that looks like a **{labelLower} match ({percent}%)** for your {mine} report **"{petName}"**.',
    outro:    'Open the Matching tab in TunTon to compare the two reports and contact the other person.',
    button:   'View match',
    footer:   FOOTER,
    /* Table of details about the NEW report: [row title, how to read it]. Empty values are skipped.
       Do not add phone / Facebook / e-mail: the owner sees those inside TunTon. */
    details: [
      ['Pet',   r => [cap(r.species), r.breed].filter(Boolean).join(' / ')],
      ['Color', r => r.color],
      ['Size',  r => cap(String(r.size || '').replace('_', ' '))],
      ['Area',  r => r.barangay],
      ['Date',  r => r.event_date]
    ]
  },

  /* 2. Someone sent a claim on one of your reports ("I found this pet" / "This is my pet"). */
  claim: {
    subject:  'New claim on your {mine} pet report "{petName}"',
    title:    'New claim on your report',
    subtitle: 'For your {mine} pet "{petName}"',
    greeting: 'Hi {ownerName},',
    intro:    '**{claimantName}** sent a claim on your {mine} report **"{petName}"**: {claimMeaning}.',
    outro:    'Open your report in TunTon to review the claim and approve or reject it.',
    button:   'Review claim',
    footer:   FOOTER,
    /* Table of details from the CLAIM (the claimant's contact details are shown inside TunTon, never here). */
    details: [
      ['Markings', c => shorten(c.markings, 150)],
      ['Seen at',  c => shorten(c.pet_location, 150)],
      ['Date',     c => c.event_date],
      ['Message',  c => shorten(c.description, 250)]
    ]
  },

  /* 3. An admin suspended your account. {reason} is the one the admin typed (it is also shown at login).
     Permanent suspensions use intro/outro; timed ones use introTimed/outroTimed, where {length} is "3 days" etc. and
     {ends} is the date and time the suspension is lifted automatically. */
  suspension: {
    subject:  'Your TunTon account has been suspended',
    subjectTimed: 'Your TunTon account is suspended for {length}',
    title:    'Account suspended',
    subtitle: 'Your TunTon account is on hold',
    subtitleTimed: 'Suspended for {length}, until {ends}',
    greeting: 'Hi {ownerName},',
    intro:    'An administrator **suspended your TunTon account**. While it is suspended you cannot log in, and your pet reports and claims are hidden.',
    introTimed: 'An administrator **suspended your TunTon account for {length}**. The suspension ends on **{ends}**. Until then you cannot log in, and your pet reports and claims are hidden.',
    outro:    'If you think this was a mistake, please contact the TunTon administrators. Your reports will come back if your account is reactivated.',
    outroTimed: 'You do not need to do anything: your account is reactivated automatically on {ends} and your reports come back. If you think this was a mistake, please contact the TunTon administrators.',
    button:   'Visit TunTon',
    footer:   ACCOUNT_FOOTER,
    details: [
      ['Reason',   s => shorten(s.reason, 300)],
      ['Length',   s => s.length],
      ['Ends on',  s => s.ends],
      ['Date',     s => s.date]
    ]
  }
};

/* What a claim means, by claim_type (used for {claimMeaning}). */
const CLAIM_MEANING = { found_it: 'they say they found this pet', my_pet: 'they say this is their pet' };

/* ---- Small helpers ---- */
const shorten = (t, n) => { const x = String(t == null ? '' : t).replace(/\s+/g, ' ').trim(); return x.length > n ? x.slice(0, n - 1) + '\u2026' : x; };

/* Replaces {name} with vars.name. Unknown placeholders are left as they are so a typo is easy to spot. */
const fill = (template, vars) => String(template).replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));

/* [[title, value], ...] for the details table, without empty rows. */
const detailRows = (details, data) => details.map(([title, read]) => [title, read(data)]).filter(([, value]) => value);

/* **bold** markers: removed in the plain-text version, turned into <strong> in the HTML (after escaping). */
const plain = t => String(t).replace(/\*\*/g, '');
const rich = t => esc(t).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

const hasLogo = () => { try { return fs.existsSync(EMAIL_STYLE.logoFile); } catch (e) { return false; } };
/* Passed to sendMail so the logo travels inside the e-mail. */
const mailAttachments = () => hasLogo() ? [{ filename: 'tunton-logo.png', path: EMAIL_STYLE.logoFile, cid: LOGO_CID }] : [];

/* Plain-text version (shown by e-mail apps that do not display HTML). */
function renderText({ title, subtitle, greeting, intro, rows, outro, url, footer }) {
  return [title, subtitle, '', greeting, '', plain(intro), '', ...rows.map(([k, v]) => `${k}: ${v}`), '', plain(outro), url, '', footer].join('\n');
}

/* HTML version: coloured header with logo, white card, details box, centred button. Built from tables because
   e-mail apps (Gmail, Outlook) handle those most reliably. esc() is applied to every value, so text from the
   database cannot inject HTML. */
function renderHtml({ title, subtitle, greeting, intro, rows, outro, url, button, footer }) {
  const st = EMAIL_STYLE, F = `font-family:${st.font};`;
  const logo = hasLogo()
    ? `<img src="cid:${LOGO_CID}" width="${st.logoWidth}" alt="TunTon" style="display:block;margin:0 auto;border:0;max-width:100%;height:auto">`
    : `<div style="${F}font-size:30px;font-weight:bold;letter-spacing:1px;color:${st.headerText}">TunTon</div>`;
  const box = rows.length ? `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:6px 0 24px"><tr>
<td style="background:${st.boxBg};border-left:4px solid ${st.boxBorder};padding:14px 18px;border-radius:0 8px 8px 0">
<table role="presentation" cellpadding="0" cellspacing="0" style="font-size:15px;line-height:1.6;color:${st.text}">${
    rows.map(([k, v]) => `<tr><td style="padding:2px 16px 2px 0;color:${st.muted};vertical-align:top;white-space:nowrap">${esc(k)}</td><td style="padding:2px 0">${esc(v)}</td></tr>`).join('')}</table>
</td></tr></table>` : '';
  return `<div style="background:${st.pageBg};padding:28px 12px;${F}">
<table role="presentation" align="center" width="100%" cellpadding="0" cellspacing="0" style="max-width:${st.width}px;margin:0 auto;background:${st.cardBg};border-radius:${st.radius}px;overflow:hidden">
<tr><td align="center" style="background-color:${st.headerFrom};background-image:linear-gradient(135deg,${st.headerFrom},${st.headerTo});padding:36px 24px 32px;text-align:center">
${logo}
<h1 style="${F}margin:20px 0 8px;font-size:28px;line-height:1.25;color:${st.headerText}">${esc(title)}</h1>
<p style="${F}margin:0;font-size:16px;color:${st.headerSubtext}">${esc(subtitle)}</p>
</td></tr>
<tr><td style="${F}padding:38px 40px 14px;font-size:17px;line-height:1.8;color:${st.text}">
<p style="margin:0 0 18px;font-weight:bold;color:${st.heading}">${esc(greeting)}</p>
<p style="margin:0 0 20px">${rich(intro)}</p>${box}
<p style="margin:0 0 28px">${rich(outro)}</p>
<p style="margin:0 0 24px;text-align:center"><a href="${esc(url)}" style="${F}display:inline-block;background-color:${st.buttonFrom};background-image:linear-gradient(135deg,${st.buttonFrom},${st.buttonTo});color:${st.buttonText};font-size:17px;font-weight:bold;text-decoration:none;padding:16px 38px;border-radius:8px">${esc(button)}</a></p>
</td></tr>
<tr><td style="${F}padding:4px 40px 30px;text-align:center;font-size:12px;line-height:1.5;color:${st.faint}">${esc(footer)}</td></tr>
</table></div>`;
}

/* Fills one template (EMAIL.match or EMAIL.claim) and returns { subject, text, html }. */
function compose(tpl, vars, data, url) {
  const parts = {
    title: fill(tpl.title, vars), subtitle: fill(tpl.subtitle, vars), greeting: fill(tpl.greeting, vars),
    intro: fill(tpl.intro, vars), rows: detailRows(tpl.details, data), outro: fill(tpl.outro, vars),
    button: fill(tpl.button, vars), footer: fill(tpl.footer, vars), url
  };
  return { subject: fill(tpl.subject, vars), text: renderText(parts), html: renderHtml(parts) };
}

/* ---- Messages (pure: unit-tested) ---- */

/* Match e-mail. ownerReport = report of the person being e-mailed, newReport = the one just posted. */
function buildMessage({ ownerName, ownerReport, newReport, score, label, url }) {
  const vars = {
    ownerName, petName: ownerReport.pet_name, label, labelLower: label.toLowerCase(), percent: Math.round(score),
    mine: ownerReport.type === 'lost' ? 'lost' : 'found',
    theirs: newReport.type === 'lost' ? 'lost' : 'found'
  };
  return compose(EMAIL.match, vars, newReport, url);
}

/* Claim e-mail. report = the claimed report ({ type, pet_name }), claim = { claimant_name, claim_type, markings, ... }. */
function buildClaimMessage({ ownerName, report, claim, url }) {
  const vars = {
    ownerName, petName: report.pet_name, mine: report.type === 'lost' ? 'lost' : 'found',
    claimantName: firstName(claim.claimant_name), claimMeaning: CLAIM_MEANING[claim.claim_type] || 'they sent a claim'
  };
  return compose(EMAIL.claim, vars, claim, url);
}

/* Date and time as shown in e-mails, e.g. "November 21, 2026, 10:45 AM GMT+8". MAIL_TIMEZONE (default Asia/Manila)
   decides the time zone, because the server may run in UTC. */
const MAIL_TZ = () => process.env.MAIL_TIMEZONE || 'Asia/Manila';
const fmtDateTime = ms => new Intl.DateTimeFormat('en-US', { timeZone: MAIL_TZ(), year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(new Date(ms));
const fmtDate = ms => new Intl.DateTimeFormat('en-US', { timeZone: MAIL_TZ(), year: 'numeric', month: 'long', day: 'numeric' }).format(new Date(ms));

/* Suspension e-mail. reason = the admin's reason, date = text for the "Date" row, durationLabel = "3 days" / "Permanent",
   endsText = when a timed suspension is lifted (empty for a permanent one). */
function buildSuspensionMessage({ ownerName, reason, date, durationLabel = '', endsText = '', url }) {
  const t = EMAIL.suspension, timed = Boolean(endsText);
  const vars = { ownerName, reason, length: durationLabel, ends: endsText };
  const tpl = timed
    ? { ...t, subject: t.subjectTimed, subtitle: t.subtitleTimed, intro: t.introTimed, outro: t.outroTimed }
    : t;
  return compose(tpl, vars, { reason, length: durationLabel, ends: endsText, date }, url);
}

/* ---- Queue (called inside matchRunner's transaction) ----
   ownerReportId = the existing report whose owner is told; newReportId = the report that was just created. */
async function queueMatchEmail(conn, { ownerReportId, newReportId, lostId, foundId, score, label }) {
  if (!(score >= CFG.minScore)) return false;   // weaker matches are still shown in the app, just not e-mailed
  const rows = async id => (await conn.query(
    `SELECT r.report_id, r.user_id, r.report_type AS type, r.pet_name, r.species, r.breed, r.color, r.size, r.event_date,
            bg.name AS barangay, u.email, u.full_name, u.status AS user_status
       FROM pet_reports r JOIN users u ON u.user_id = r.user_id LEFT JOIN barangays bg ON bg.barangay_id = r.barangay_id
      WHERE r.report_id = ?`, [id]))[0][0];
  const [owner, fresh] = [await rows(ownerReportId), await rows(newReportId)];
  if (!owner || !fresh || !owner.email || owner.user_status !== 'active' || owner.user_id === fresh.user_id) return false;

  /* The Matching tab with the owner's report already selected (matching.js reads ?report=<id>). */
  const url = `${baseUrl()}/pages/user/dashboard/matching?report=${encodeURIComponent(owner.report_id)}`;
  const msg = buildMessage({ ownerName: firstName(owner.full_name), ownerReport: owner, newReport: fresh, score, label, url });
  const [r] = await conn.query(
    `INSERT IGNORE INTO email_notifications (user_id, lost_report_id, found_report_id, to_email, subject, body_text, body_html)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [owner.user_id, lostId, foundId, owner.email, msg.subject.slice(0, 200), msg.text, msg.html]);
  return r.affectedRows === 1;
}

/* ---- Queue a claim e-mail (called inside claimsController.create's transaction) ----
   Tells the owner of the claimed report that someone sent a claim on it. One e-mail per claim. */
async function queueClaimEmail(conn, claimId) {
  const [[c]] = await conn.query(
    `SELECT c.claim_id, c.claim_type, c.description, c.markings, c.pet_location, c.event_date, c.claimant_user_id,
            cu.full_name AS claimant_name, r.report_id, r.user_id AS owner_id, r.report_type AS type, r.pet_name,
            ou.email, ou.full_name AS owner_name, ou.status AS user_status
       FROM claims c JOIN users cu ON cu.user_id = c.claimant_user_id
       JOIN pet_reports r ON r.report_id = c.report_id JOIN users ou ON ou.user_id = r.user_id
      WHERE c.claim_id = ?`, [claimId]);
  if (!c || !c.email || c.user_status !== 'active' || c.owner_id === c.claimant_user_id) return false;

  const url = `${baseUrl()}/pages/user/dashboard/report?id=${encodeURIComponent(c.report_id)}`;
  const msg = buildClaimMessage({ ownerName: firstName(c.owner_name), report: c, claim: c, url });
  const [r] = await conn.query(
    `INSERT IGNORE INTO email_notifications (user_id, kind, claim_id, to_email, subject, body_text, body_html)
     VALUES (?, 'claim', ?, ?, ?, ?, ?)`,
    [c.owner_id, claimId, c.email, msg.subject.slice(0, 200), msg.text, msg.html]);
  return r.affectedRows === 1;
}

/* ---- Queue a suspension e-mail (called inside adminController.setUserStatus's transaction) ----
   Goes into the same outbox as the other e-mails, so the batch worker sends it (EMAIL_BATCH_SIZE every
   EMAIL_BATCH_INTERVAL_SECONDS) and a burst of suspensions never exceeds the mail provider's limit.
   Called when the account is suspended, or suspended again with a new reason or length; repeating the same permanent suspension sends nothing new.
   If the transaction rolls back, the e-mail disappears with it. */
async function queueSuspensionEmail(conn, { userId, email, fullName, reason, durationLabel = 'Permanent', untilMs = null }) {
  if (!email) return false;
  const msg = buildSuspensionMessage({
    ownerName: firstName(fullName), reason, date: fmtDate(Date.now()), durationLabel,
    endsText: untilMs ? fmtDateTime(untilMs) : '', url: baseUrl()
  });
  const [r] = await conn.query(
    `INSERT INTO email_notifications (user_id, kind, to_email, subject, body_text, body_html)
     VALUES (?, 'suspension', ?, ?, ?, ?)`,
    [userId, email, msg.subject.slice(0, 200), msg.text, msg.html]);
  return r.affectedRows === 1;
}

/* ---- Sending ---- */
let transport; // undefined = not tried yet, null = not configured
function getTransport() {
  if (transport !== undefined) return transport;
  const { SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_HOST) return (transport = null);
  try {
    transport = require('nodemailer').createTransport({
      host: SMTP_HOST, port: Number(SMTP_PORT) || 587, secure: /^(1|true|yes)$/i.test(SMTP_SECURE || ''),
      auth: SMTP_USER ? { user: SMTP_USER, pass: SMTP_PASS } : undefined
    });
  } catch (e) {
    console.error('[email] nodemailer is not installed. Run: npm install'); transport = null;
  }
  return transport;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
let running = false;

/* Send ONE batch. Returns { sent, failed, pending } (pending = still waiting after this batch). */
async function sendBatch() {
  const out = { sent: 0, failed: 0, pending: 0 };
  const tx = getTransport();
  if (!tx || running) return out;
  running = true;
  try {
    let room = CFG.batchSize;
    if (CFG.dailyLimit) {
      const [[{ n }]] = await pool.query("SELECT COUNT(*) AS n FROM email_notifications WHERE status = 'sent' AND sent_at >= CURDATE()");
      room = Math.min(room, Math.max(0, CFG.dailyLimit - n));
    }
    if (room > 0) {
      const [batch] = await pool.query(
        "SELECT notification_id, to_email, subject, body_text, body_html, attempts FROM email_notifications WHERE status = 'pending' ORDER BY notification_id LIMIT ?", [room]);
      for (const [i, m] of batch.entries()) {
        try {
          await tx.sendMail({ from: process.env.MAIL_FROM || process.env.SMTP_USER, to: m.to_email, subject: m.subject, text: m.body_text, html: m.body_html, attachments: mailAttachments() });
          await pool.query("UPDATE email_notifications SET status = 'sent', attempts = attempts + 1, sent_at = NOW(), last_error = NULL WHERE notification_id = ?", [m.notification_id]);
          out.sent++;
        } catch (e) {
          const dead = m.attempts + 1 >= CFG.maxAttempts;
          await pool.query('UPDATE email_notifications SET status = ?, attempts = attempts + 1, last_error = ? WHERE notification_id = ?',
            [dead ? 'failed' : 'pending', String(e.message).slice(0, 250), m.notification_id]);
          out.failed++;
          console.error(`[email] #${m.notification_id} ${dead ? 'gave up' : 'will retry'}:`, e.message);
        }
        if (i < batch.length - 1 && CFG.sendDelayMs) await sleep(CFG.sendDelayMs);
      }
    }
    const [[{ waiting }]] = await pool.query("SELECT COUNT(*) AS waiting FROM email_notifications WHERE status = 'pending'");
    out.pending = waiting;
  } catch (e) {
    console.error('[email] batch failed:', e.message);
  } finally { running = false; }
  return out;
}

/* Called once from server.js. Does nothing (and says so) when SMTP_HOST is not set; queued e-mails then just wait. */
function startWorker() {
  if (!process.env.SMTP_HOST) {
    console.warn('[email] SMTP_HOST is not set: e-mails (matches, claims, suspensions) are queued but not sent. See .env.example.');
    return null;
  }
  console.log(`[email] sending up to ${CFG.batchSize} e-mails every ${CFG.intervalMs / 1000}s${CFG.dailyLimit ? `, max ${CFG.dailyLimit}/day` : ''}`);
  const timer = setInterval(() => { sendBatch().catch(e => console.error('[email]', e.message)); }, CFG.intervalMs);
  timer.unref();
  return timer;
}

module.exports = { CFG, buildMessage, buildClaimMessage, buildSuspensionMessage, queueMatchEmail, queueClaimEmail, queueSuspensionEmail, sendBatch, startWorker };