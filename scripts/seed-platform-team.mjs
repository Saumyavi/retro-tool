// Seed test data for the Platform team.
// Run: node --env-file=.env.local scripts/seed-platform-team.mjs
import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !key) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY');
  console.error('Run with: node --env-file=.env.local scripts/seed-platform-team.mjs');
  process.exit(1);
}

const sb = createClient(url, key);

let seq = 1;
function uid() { return 'c-seed' + String(seq++).padStart(3, '0'); }
function ts(isoDate) { return new Date(isoDate).getTime(); }

// ── Seed data ─────────────────────────────────────────────────────────────────
const ROOMS = [
  {
    code: 'PLAT45', sprint_name: 'Sprint 45', creator: 'Priya',
    team: 'Platform team', created_at: '2026-04-02T10:00:00Z',
    participants: ['Priya', 'Tom', 'Ananya', 'James'],
    cards: [
      { phase: 'wentWell', text: 'Daily standups stayed under 15 min all sprint', author: 'Priya', votes: 4 },
      { phase: 'wentWell', text: 'Feature flag rollout for the new billing UI went smoothly', author: 'Tom', votes: 3 },
      { phase: 'wentWell', text: 'No production incidents this sprint — first time in 6 sprints!', author: 'Ananya', votes: 5 },
      { phase: 'continue', text: 'Weekly design review on Wednesdays', author: 'James', votes: 3 },
      { phase: 'continue', text: 'Async PRs for sub-200-line changes', author: 'Priya', votes: 2 },
      { phase: 'continue', text: 'Pairing on complex tickets before estimating', author: 'Tom', votes: 4 },
      { phase: 'improve',  text: 'Deployment pipeline takes 22+ min — need to parallelize', author: 'Ananya', votes: 5 },
      { phase: 'improve',  text: 'Too many context switches between projects mid-sprint', author: 'Tom', votes: 3 },
      { phase: 'improve',  text: 'Test environment keeps drifting from prod config', author: 'James', votes: 2 },
      { phase: 'actions',  text: 'Set up deployment job queue to cut pipeline time in half', author: 'Ananya', votes: 0, assignee: 'Ananya', due: '2026-04-16', status: 'done' },
      { phase: 'actions',  text: 'Create PR checklist template in Notion', author: 'Priya', votes: 0, assignee: 'Priya', due: '2026-04-09', status: 'done' },
      { phase: 'actions',  text: 'Document the new auth service flow for onboarding', author: 'Tom', votes: 0, assignee: 'Tom', due: '2026-04-16', status: 'open' },
      { phase: 'actions',  text: 'Reduce CI build time below 8 minutes (currently 22)', author: 'James', votes: 0, assignee: 'James', due: '2026-04-30', status: 'open' },
    ],
  },
  {
    code: 'PLAT46', sprint_name: 'Sprint 46', creator: 'Tom',
    team: 'Platform team', created_at: '2026-04-23T10:00:00Z',
    participants: ['Priya', 'Tom', 'Ananya', 'James', 'Lena'],
    cards: [
      { phase: 'wentWell', text: 'Pair programming sessions unblocked the payments work', author: 'Lena', votes: 4 },
      { phase: 'wentWell', text: 'Zero-downtime deploy succeeded on first try', author: 'Ananya', votes: 5 },
      { phase: 'wentWell', text: 'PR cycle time dropped from 3 days to 1 day', author: 'Tom', votes: 3 },
      { phase: 'continue', text: 'Frontend Friday demos — team loves the visibility', author: 'Priya', votes: 4 },
      { phase: 'continue', text: 'PR size limit of 400 lines', author: 'James', votes: 3 },
      { phase: 'continue', text: 'Blameless postmortems for any on-call page', author: 'Lena', votes: 5 },
      { phase: 'improve',  text: 'On-call rotation schedule was unclear — two people thought they were off', author: 'Tom', votes: 5 },
      { phase: 'improve',  text: 'Test coverage dropped to 61% — below the 70% target', author: 'Ananya', votes: 4 },
      { phase: 'improve',  text: 'Auth module has no clear owner, PRs sit for days', author: 'Priya', votes: 3 },
      { phase: 'improve',  text: 'Too many meetings without agendas', author: 'Lena', votes: 2 },
      { phase: 'actions',  text: 'Write on-call runbook with escalation paths', author: 'Tom', votes: 0, assignee: 'Tom', due: '2026-05-07', status: 'done' },
      { phase: 'actions',  text: 'Add contract tests for the payments API', author: 'Ananya', votes: 0, assignee: 'Ananya', due: '2026-05-07', status: 'done' },
      { phase: 'actions',  text: 'Document the new auth service flow for onboarding', author: 'Priya', votes: 0, assignee: 'Tom', due: '2026-05-07', status: 'open' },
      { phase: 'actions',  text: 'Reduce p95 API latency to <200ms (currently 340ms)', author: 'James', votes: 0, assignee: 'James', due: '2026-05-21', status: 'open' },
      { phase: 'actions',  text: 'Assign a named owner to the auth module', author: 'Lena', votes: 0, assignee: 'Priya', due: '2026-04-30', status: 'open' },
    ],
  },
  {
    code: 'PLAT47', sprint_name: 'Sprint 47', creator: 'Priya',
    team: 'Platform team', created_at: '2026-05-07T10:00:00Z',
    participants: ['Priya', 'Tom', 'Ananya', 'Lena'],
    cards: [
      { phase: 'wentWell', text: 'Launched the new search feature — users love it', author: 'Priya', votes: 6 },
      { phase: 'wentWell', text: 'Team morale noticeably better since we fixed the on-call rotation', author: 'Lena', votes: 4 },
      { phase: 'wentWell', text: 'Build time is down to 9 min with the parallelised pipeline', author: 'Ananya', votes: 3 },
      { phase: 'wentWell', text: 'The new PR template is catching issues before review', author: 'Tom', votes: 3 },
      { phase: 'continue', text: 'Mob review sessions for critical path changes', author: 'Ananya', votes: 4 },
      { phase: 'continue', text: 'Clear sprint goals posted in Slack at kickoff', author: 'Priya', votes: 3 },
      { phase: 'improve',  text: 'Tech debt accumulating in the auth module — need a dedicated sprint', author: 'Tom', votes: 5 },
      { phase: 'improve',  text: 'Staging environment is unstable — broke 3 demos this sprint', author: 'Lena', votes: 5 },
      { phase: 'improve',  text: 'Integration tests are flaky — failing 1 in 5 runs with no code change', author: 'Ananya', votes: 4 },
      { phase: 'actions',  text: 'Fix the 4 flaky integration tests in the auth suite', author: 'Ananya', votes: 0, assignee: 'Ananya', due: '2026-05-21', status: 'open' },
      { phase: 'actions',  text: 'Migrate auth module to new service pattern (spike first)', author: 'Priya', votes: 0, assignee: 'Tom', due: '2026-05-28', status: 'open' },
      { phase: 'actions',  text: 'Set up Datadog monitors for staging environment health', author: 'Lena', votes: 0, assignee: 'Lena', due: '2026-05-21', status: 'open' },
      { phase: 'actions',  text: 'Reduce p95 API latency to <200ms (carried over from Sprint 46)', author: 'James', votes: 0, assignee: 'James', due: '2026-05-28', status: 'open' },
      { phase: 'actions',  text: 'Document the new auth service flow for onboarding', author: 'Tom', votes: 0, assignee: 'Tom', due: '2026-05-14', status: 'open' },
      { phase: 'actions',  text: 'Run a load test on the new search endpoint', author: 'Priya', votes: 0, assignee: 'Priya', due: '2026-05-21', status: 'done' },
    ],
  },
];

async function seed() {
  for (const room of ROOMS) {
    const { error: rErr } = await sb.from('retro_rooms').upsert(
      { code: room.code, sprint_name: room.sprint_name, creator: room.creator, team: room.team, created_at: room.created_at },
      { onConflict: 'code' },
    );
    if (rErr) { console.error(`Room ${room.code}:`, rErr.message); continue; }
    console.log(`✓ room ${room.code} (${room.sprint_name})`);

    const parts = room.participants.map((name) => ({ room_code: room.code, name }));
    await sb.from('retro_participants').upsert(parts, { onConflict: 'room_code,name' });

    const baseTs = ts(room.created_at);
    const rows = room.cards.map((c, i) => ({
      id:         uid(),
      room_code:  room.code,
      phase:      c.phase,
      text:       c.text,
      author:     c.author,
      votes:      c.votes ?? 0,
      rotation:   0,
      created_at: baseTs + i * 60_000,
      assignee:   c.assignee ?? null,
      due:        c.due ?? null,
      status:     c.status ?? 'open',
    }));
    const { error: cErr } = await sb.from('retro_cards').insert(rows);
    if (cErr) console.error(`  Cards ${room.code}:`, cErr.message);
    else console.log(`  ↳ ${rows.length} cards inserted`);
  }
  console.log('\nDone. Room codes: PLAT45 · PLAT46 · PLAT47');
}

seed().catch(console.error);
