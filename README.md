# Retro — Real-time Sprint Retrospectives

A clean, fast retrospective tool for engineering teams. Create a room, share the code, and run your retro with live card sync, voting, and PDF export — no login required.

---

## Features

- **Four-column board** — Went Well · Continue Doing · To Improve · Action Items
- **Real-time sync** — cards and participants update instantly across all browsers (via Supabase)
- **Room codes** — 6-character codes for instant joining; only valid rooms can be entered
- **Facilitator controls** — reveal/hide all cards (creator only), phase timer with editable duration
- **Voting** — upvote cards; votes are per-device and persist across refreshes
- **Anonymous cards** — toggle "Anon" per card in the composer to post without your name
- **Drag & drop** — move cards between columns
- **Action items** — convert "To Improve" cards to Action Items with one click; add assignee + due date
- **PDF export** — one-click export that opens a print-ready page
- **Phase navigation** — "Next phase" button cycles through all four columns and restarts the timer

---

## Tech Stack

| Layer | Choice |
|---|---|
| Framework | Next.js 16 (App Router) |
| Language | TypeScript |
| Database + Realtime | Supabase (PostgreSQL + WebSockets) |
| Fonts | Google Fonts via `next/font` |
| Styling | Inline styles + CSS variables (no component library) |
| Deployment | Vercel (recommended) |

---

## Prerequisites

- Node.js 18+
- A [Supabase](https://supabase.com) project (free tier is sufficient)

---

## Local Development

```bash
# 1. Clone and install
git clone <your-repo-url>
cd retrospective-app
npm install

# 2. Add environment variables (see section below)

# 3. Run the database migration (see Supabase Setup)

# 4. Start the dev server
npm run dev
# → http://localhost:3000
```

---

## Supabase Setup

### 1. Create a project

Go to [supabase.com](https://supabase.com), create a new project, and note your **Project URL** and **anon public key** from *Settings → API*.

### 2. Run the schema migration

Open the **SQL Editor** in your Supabase dashboard and run this once:

```sql
-- Rooms (tracks valid rooms and their creator)
create table if not exists retro_rooms (
  code        text primary key,
  creator     text not null,
  sprint_name text,
  team        text,
  created_at  timestamptz not null default now()
);

-- Cards
create table if not exists retro_cards (
  id           text primary key,
  room_code    text not null,
  phase        text not null,
  text         text not null,
  author       text not null,
  votes        integer not null default 0,
  rotation     float not null default 0,
  created_at   bigint not null,
  assignee     text,
  due          text,
  derived_from text
);

create index if not exists retro_cards_room_idx on retro_cards (room_code);

-- Comments
create table if not exists retro_comments (
  id         text primary key,
  card_id    text not null,
  room_code  text not null,
  author     text not null,
  text       text not null,
  created_at bigint not null
);
create index if not exists retro_comments_card_idx on retro_comments (card_id);
alter table retro_comments enable row level security;
create policy "open" on retro_comments for all using (true) with check (true);

-- Spotlight (facilitator discussion focus)
create table if not exists retro_spotlight (
  room_code text primary key,
  card_id   text
);
alter table retro_spotlight enable row level security;
create policy "open" on retro_spotlight for all using (true) with check (true);

-- Participants
create table if not exists retro_participants (
  room_code  text not null,
  name       text not null,
  joined_at  timestamptz not null default now(),
  primary key (room_code, name)
);

-- Row-level security (open access — tighten if you add auth)
alter table retro_rooms        enable row level security;
alter table retro_cards        enable row level security;
alter table retro_participants enable row level security;

create policy "open" on retro_rooms        for all using (true) with check (true);
create policy "open" on retro_cards        for all using (true) with check (true);
create policy "open" on retro_participants for all using (true) with check (true);

-- Enable realtime
alter publication supabase_realtime add table retro_cards;
alter publication supabase_realtime add table retro_participants;
alter publication supabase_realtime add table retro_comments;
alter publication supabase_realtime add table retro_spotlight;
```

### 3. Set environment variables

Create a `.env.local` file in the project root:

```env
NEXT_PUBLIC_SUPABASE_URL=https://<your-project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<your-anon-key>
```

---

## Environment Variables

| Variable | Description |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Your Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Your Supabase anon (public) key |

> **Windows users:** save `.env.local` with **LF** line endings, not CRLF. CRLF appends an invisible `\r` that breaks URL parsing. In VS Code, click the `CRLF` indicator in the status bar and switch to `LF`.

---

## Scripts

```bash
npm run dev      # Development server → http://localhost:3000
npm run build    # Production build
npm run start    # Serve the production build locally
npm run lint     # ESLint
```

---

## How It Works

### For the facilitator (room creator)

1. Go to the landing page → **Start new** tab
2. Enter a sprint name, team name, and your name
3. Click **Create & open** — you land on the board with a 6-character room code shown in the header
4. Share the code with your team (via Slack, Teams, etc.)
5. You are the only one who can toggle **Revealed / Hidden** — this blurs all card text for everyone until you reveal
6. Use **Next phase →** to advance through columns; it restarts the timer automatically

### For team members

1. Go to the landing page → **Join a retro** tab (the default)
2. Enter the 6-character room code shared by the facilitator
3. Enter your name, or toggle **Join anonymously**
4. Click **Drop in** — you land on the live board instantly

### During the retro

| Action | How |
|---|---|
| Add a card | Click **+** in any column header |
| Post anonymously | Toggle **Anon** in the card composer before clicking Add |
| Edit a card | Double-click the card text, or **⋯** menu → Edit |
| Delete a card | **⋯** menu → Delete |
| Vote | Click the **▲** button on a card (per-device, persists on refresh) |
| Move a card | Drag it to another column |
| Convert to action item | **⋯** menu on a "To Improve" card → Convert → action item |
| Edit timer duration | Click the **MM:SS** display while paused, type a new value, press Enter |
| Export | Click **Export PDF** in the sub-header bar |

---

## Deployment

### Vercel (recommended)

```bash
git add .
git commit -m "production ready"
git push
```

Then in [Vercel](https://vercel.com):
1. Import the GitHub repository
2. Go to **Settings → Environment Variables** and add both `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`
3. Click **Deploy**

Vercel auto-detects Next.js and handles builds, previews, and edge caching.

### Self-hosted

```bash
npm run build
npm start
# Runs on port 3000
```

### Docker

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build
EXPOSE 3000
CMD ["npm", "start"]
```

---

## Project Structure

```
retrospective-app/
├── app/
│   ├── layout.tsx        # Root layout — font loading, metadata
│   ├── globals.css       # CSS variables, global reset
│   ├── page.tsx          # Landing page (join / create)
│   └── board/
│       └── page.tsx      # Retro board — all board logic lives here
├── lib/
│   └── supabase.ts       # Supabase client singleton
├── public/               # Static assets (favicon, etc.)
├── .env.local            # Local env vars — not committed
└── next.config.ts        # Next.js config
```

---

## Troubleshooting

**"Room not found" when joining**
The `retro_rooms` table must exist in Supabase. Run the migration SQL above if you haven't already.

**Cards not syncing in real time**
Confirm the `supabase_realtime` publication includes `retro_cards` and `retro_participants`. Re-run the last two `alter publication` lines from the migration.

**Reveal button is greyed out**
Only the browser that clicked "Create & open" can reveal cards — this is stored in `localStorage` under the key `retro-creator-<code>`. If you need to restore creator access on a different device, open DevTools → Application → Local Storage, add the key `retro-creator-<your-code>` with value `1`, and refresh.

**`Invalid supabaseUrl` error on Windows**
Your `.env.local` has CRLF line endings. Open it in VS Code, click `CRLF` in the status bar, switch to `LF`, and save.

**Build fails after pulling updates**
Run `npm install` — a dependency version may have changed.
