/* Suspension lengths and automatic lifting (fake database: no MySQL needed). Run: npm test */
const test = require('node:test');
const assert = require('node:assert/strict');
const { DURATIONS, restoreReports } = require('../services/suspensions');

test('the four lengths: 3, 7, 30 days or permanent', () => {
  assert.deepEqual(Object.keys(DURATIONS), ['3d', '7d', '30d', 'permanent']);
  assert.deepEqual(Object.values(DURATIONS).map(d => d.days), [3, 7, 30, null]);
  assert.equal(DURATIONS.permanent.label, 'Permanent');
});

/* Fake connection for restoreReports: report 1 was hidden by the suspension, report 2 by an admin on its own. */
const fakeConn = () => {
  const writes = [];
  return {
    writes,
    query: async (sql, p) => {
      if (sql.startsWith('SELECT report_id FROM pet_reports')) return [[{ report_id: 1 }, { report_id: 2 }]];
      if (sql.includes('FROM activity_logs')) return [[p[0] === 1 ? { action: 'report_hidden_owner_suspended', previous_status: 'active' } : { action: 'report_removed', previous_status: null }]];
      writes.push([sql, p]); return [{}];
    }
  };
};

test('lifting brings back only the reports the suspension hid', async () => {
  const c = fakeConn();
  const back = await restoreReports(c, 9, null);
  assert.deepEqual(back, [1]);
  const updates = c.writes.filter(([sql]) => sql.startsWith('UPDATE pet_reports'));
  assert.equal(updates.length, 1);
  assert.deepEqual(updates[0][1], ['active', 1]);
});