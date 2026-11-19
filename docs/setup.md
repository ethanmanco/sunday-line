# Setting up Supabase, Vercel, and GitHub

Your accounts, your clicks. About 15 minutes. Never paste a password or a secret key into chat.

## 1. GitHub repo (I can do this)
Public repo `ethanmanco/sunday-line`. I create it and push as ethanmanco, then switch `gh` back to MancoLabs. Vercel needs it to deploy.

## 2. Supabase (database, sign-in, photo storage)
1. Go to supabase.com and sign in (GitHub sign-in as ethanmanco is easiest).
2. **New project**
   - Organization: your personal one (create "Ethan" if asked), Free plan.
   - Name: `sunday-line`.
   - Database password: click Generate, save it in your password manager. You'll type it once in a terminal later.
   - Region: a US region near you, for example East US (Ohio).
3. Wait about 2 minutes for it to start.
4. **Copy two public values** from Project Settings, then API Keys (or Connect):
   - Project URL (looks like `https://abcd1234.supabase.co`)
   - Publishable key (older projects call it the `anon` key)
   These are safe to share; the database rules protect the data. Do **not** copy the secret or `service_role` key anywhere.
5. **Sign-in settings:** Authentication, then Sign In / Providers: make sure Email is on. Magic links work out of the box.
6. **Redirect addresses:** Authentication, then URL Configuration:
   - Site URL: your Vercel address from step 3 (come back after step 3).
   - Redirect URLs: add `http://localhost:3210/**` and `https://<your-vercel-address>/**`.
7. **Link this folder** so I can push database changes. In a terminal in `sunday-line`:
   ```
   npx supabase login
   npx supabase link --project-ref <the part before .supabase.co>
   ```
   `login` opens your browser to approve. `link` asks for the database password from step 2.

Note: the built-in email sender only sends a few sign-in emails per hour. Fine for testing; for real use we add a free sender (Resend) later.

## 3. Vercel (hosting)
1. Go to vercel.com and sign in with GitHub as ethanmanco. Hobby (free) plan is fine for a personal project.
2. **Add New, then Project**, and import `ethanmanco/sunday-line` (after step 1).
3. Leave the defaults (Next.js, root folder). Under Environment Variables add:
   - `NEXT_PUBLIC_SUPABASE_URL` = Project URL
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` = publishable key
4. Deploy. You get an address like `sunday-line.vercel.app`. Put it into Supabase step 6.

## 4. Send me
- The Project URL and publishable key (safe to paste).
- Your Vercel address.
- A note that `npx supabase link` finished.

## Meanwhile
I can build accounts and ratings against a local copy of Supabase in Docker, including the security tests, so none of this blocks the work.

## 5. Sign-in email (Supabase dashboard, works on a phone)
Authentication, then Emails (Templates). For both **Magic link** and **Confirm signup**:
- Subject: `Your Sunday Line sign-in code`
- Body: paste the contents of `supabase/templates/sign_in.html` from the repo.

The email then has a 6-digit code (typed into the sign-in page) and a button that works on any device.

## 6. Turning on accounts in the live site (at your computer)
1. Run the two commands in step 2.7 (`npx supabase login`, `npx supabase link ...`).
2. Tell me, and I run `npx supabase db push` to create the tables, then merge the `accounts` branch so the live site gets sign-in and ratings.
