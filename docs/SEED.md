# Demo data (seed)

Ten complete demo accounts and activity for every feature, removable in one click.

## Load / remove

- **In the app:** add your email to `ADMIN_EMAILS` (Coolify → Environment), redeploy, sign in with
  that (confirmed) email and open **/admin** (also in the account menu and the `/` bar: "admin").
  **Load demo data** (or Reload) and **Remove demo data**.
- **CLI (on the server/container):** `npm run seed`, `npm run seed:remove`, `node scripts/seed.js status`.

Loading replaces any earlier seed, so it is safe to run twice.

## Accounts

Password for all: **`@1venued`**. Emails are `<username without dots>@seed.1venue.live` (marked
confirmed, no mail is ever sent). Usernames: adaeze, chinedu.eze, ibrahim.musa, tobi.alade, ngozi.ike,
emeka.obi, aisha.bello, sarah.mensah, yusuf.abdullahi, funke.adeyemi — public pages at `/u/<username>`.

Each has a name, username/handle, photo, bio, phone (+234 800 000 01xx, not real), verified email and
phone, theme/accent/Bible preferences.

## What is created

14 events (10 upcoming, 4 past, with covers, speakers and RSVPs), 19 posts (images, scripture,
recaps), ~60 comments with replies and likes, follows, 5 YouTube materials, 3 venues with co-admins,
3 whiteboards, 5 DM threads, scheduled meetings, and 7 past sessions with attendance, chat, a
poll with votes, answered Q&A, transcript, AI summary and attendance shares.

Images are hot-linked from Unsplash (free under the Unsplash License); videos are public YouTube links.

## How removal stays exact

- Seed users have `users.is_seed = true`; nearly everything they own is deleted by cascade.
- Rows that would not cascade (sessions, comments, DM threads) are listed in `seed_rows`.
- Removal never touches rows of real users, except their likes/comments on seed content, which go
  with that content. Real users who followed a seed account simply lose that follow.

Code: `src/features/seed/` (fixtures.js = the content, seed.js = load/remove), `public/js/pages/admin.js`.
