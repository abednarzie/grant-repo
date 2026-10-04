# Grant Tracker

A per-user grant opportunity tracker. Static frontend (plain HTML/CSS/JS) that talks
directly to a **Supabase** (Postgres) backend using the Supabase JavaScript client,
with **email + password** authentication. Deployable to **Netlify**.

Each signed-in user sees only their own data — funding areas, opportunities,
requirements, actions, and targets — enforced by Postgres Row Level Security (RLS).

## Features

- **Funding areas (buckets)** with per-bucket targets
- **Opportunities** linked to a bucket, with a free-text "specifically funding" detail
- **Requirements** checklist per opportunity, with status tracking
- **Action tracker** — general to-dos on the dashboard
- **Targets** — overall + per-bucket, with awarded vs pipeline rollups
- **Auth** — email/password; data is private per user

---

## 1. Create the Supabase project & database

1. Create a project at [supabase.com](https://supabase.com).
2. In the dashboard, open **SQL Editor** and run the contents of
   [`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql).
   This creates all tables, enables RLS, and adds the per-user policies.
   The migration is idempotent, so it's safe to re-run on a fresh project.
3. Under **Authentication → Providers**, make sure **Email** is enabled.
   For quick local testing you may want to turn **off** "Confirm email"
   (Authentication → Providers → Email) so new signups can log in immediately.

> Using the Supabase CLI instead? `supabase db push` will apply the files in
> `supabase/migrations/`.

## 2. Get your API keys

In the Supabase dashboard: **Project Settings → API**. Copy:

- **Project URL** → `SUPABASE_URL`
- **anon public** key → `SUPABASE_ANON_KEY`

The anon key is meant to be public — RLS is what protects your data. Never use the
`service_role` key in this app.

## 3. Run locally

```bash
# 1. Provide your keys
cp .env.example .env
#    then edit .env and paste in your SUPABASE_URL and SUPABASE_ANON_KEY

# 2. Generate config.js from .env and serve the folder
npm run dev
```

`npm run dev` writes `config.js` (gitignored) from your `.env`, then serves the
static site. Open the printed localhost URL, sign up with an email + password,
and you're in.

> No Node? Any static server works — just run `node scripts/build-config.js`
> once to generate `config.js`, then serve the folder however you like.

## 4. Deploy to Netlify

1. Push this repo to GitHub/GitLab.
2. In Netlify: **Add new site → Import an existing project**, pick the repo.
3. Build settings are already defined in `netlify.toml`:
   - Build command: `node scripts/build-config.js`
   - Publish directory: `.`
4. Under **Site settings → Environment variables**, add:
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
5. Deploy. Netlify runs the build step, which generates `config.js` from those
   env vars, and publishes the static site.
6. Back in Supabase, add your Netlify site URL under
   **Authentication → URL Configuration → Site URL / Redirect URLs**.

---

## Project layout

```
.
├── index.html                      # app shell + login screen
├── static/
│   ├── css/main.css
│   └── js/
│       ├── supabaseClient.js       # initializes the Supabase JS client
│       ├── auth.js                 # email/password sign in / up / out
│       └── main.js                 # app logic (data via Supabase client)
├── scripts/build-config.js         # generates config.js from env vars
├── config.example.js               # reference shape of generated config.js
├── supabase/migrations/0001_init.sql
├── netlify.toml
├── .env.example                    # copy to .env (gitignored)
└── .gitignore                      # ignores .env and generated config.js
```

## Security notes

- **RLS everywhere.** Every table has RLS enabled and owner-scoped policies
  (`user_id = auth.uid()`), so the browser can hold the anon key safely.
- `.env` and the generated `config.js` are gitignored. Only `.env.example`
  and `config.example.js` are committed.
- Because the anon key ships to the browser, the security of your data depends
  entirely on the RLS policies in the migration. Don't weaken them.
