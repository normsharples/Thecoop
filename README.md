# The Coop — Pollo Rotisserie Operations Dashboard

Internal multi-restaurant ops dashboard for Pollo Rotisserie (3 Melbourne locations).

## Tech Stack

- **Frontend:** React 18 + TypeScript (Vite)
- **Styling:** Tailwind CSS v3 + shadcn/ui (new-york style)
- **Routing:** React Router v6
- **State:** TanStack Query v5 (server) + Zustand (client)
- **Auth/DB:** Supabase (Auth + PostgreSQL)
- **Charts:** Recharts
- **Calendar:** FullCalendar
- **Hosting:** Vercel

## Getting Started

### 1. Clone & install

```bash
cd the-coop
npm install
```

### 2. Set up Supabase

1. Create a project at [supabase.com](https://supabase.com)
2. Copy `.env.example` to `.env` and fill in your keys:
   ```
   VITE_SUPABASE_URL=https://your-project.supabase.co
   VITE_SUPABASE_ANON_KEY=your-anon-key
   ```
3. Run the migrations in the Supabase SQL editor — in order:
   - `supabase/migrations/001_initial_schema.sql`
   - `supabase/migrations/002_seed_data.sql`

### 3. Create the first Superadmin user

In Supabase dashboard → Authentication → Users → "Invite user" (or Add user).
Then run this SQL to set their profile role:

```sql
UPDATE profiles SET role = 'superadmin', full_name = 'Your Name' WHERE email = 'you@example.com';
```

### 4. Run locally

```bash
npm run dev
```

### 5. Deploy to Vercel

Connect the repo to Vercel, set the environment variables, and deploy. The `vercel.json` handles SPA rewrites automatically.

## Roles

| Role | Access |
|------|--------|
| `superadmin` | All restaurants, all features, user management, settings |
| `area_manager` | Assigned restaurants, reports, pulse, leaderboard, all ops tools |
| `manager` | Own restaurant only, no settings, no leaderboard (by default) |

## Project Structure

```
src/
├── components/
│   ├── layout/        # AppLayout, Sidebar, Topbar, MobileNav, RestaurantSwitcher
│   ├── ui/            # shadcn/ui components
│   ├── dashboard/     # Dashboard widgets (all with mock data)
│   ├── settings/      # TeamSettings, QuickLinksSettings + placeholders
│   └── store-profiles/ # StoreProfileView, StoreProfileForm
├── pages/             # One file per route
├── hooks/             # useAuth, usePermissions, useRestaurants, useSelectedRestaurant
├── lib/               # supabase.ts, utils.ts, constants.ts
├── types/             # index.ts — all TypeScript interfaces
└── styles/            # globals.css — Tailwind + CSS variables
supabase/
└── migrations/        # 001_initial_schema.sql, 002_seed_data.sql
```

## Phase Roadmap

| Phase | Features |
|-------|---------|
| **1 (current)** | Auth, layout, dashboard (mock data), team management, store profiles, quick links |
| **2** | Pulse report, reports (sales/labour/reviews), leaderboard, calendar, integrations |
| **3** | Checklists, stock counts, maintenance, cash deposits, catering orders, incidents |
| **4** | WHS audits, drive/documents, food cost tracking |
