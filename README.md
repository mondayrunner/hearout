# Hearout

An AI that runs the intake interview instead of a form. Every participant gets a personal link,
talks with Claude for about ten minutes, and you read one summary per person plus the full
transcript.

This repository is a small, working base to build on. It has the interview, the summary, a plain
admin page and a markdown export. It has no email invitations, no notifications and no branding.

## How it works

A **project** is one round of interviews. It holds the brief: what you want to know by the end of
every conversation, written as an instruction to the interviewer. The brief travels along as the
system prompt and is cached, so it can be long without getting expensive.

A **participant** belongs to a project and has an eight-character code. The link is
`/<project>/<code>`, for example `/example/demo` in the seed. There is no login: the code is the
key, so it is long enough that guessing one is not realistic. Codes have no 0, o, 1 or l, because
people read them aloud and type them over.

The model decides the order of the questions and how to follow up, and it may finish early. The
server decides when it is over: after `max_turns` questions (twelve by default) the model gets one
closing turn to say thanks, and the conversation ends regardless. Freedom in the conversation, no
freedom in the outcome.

When someone finishes, the server makes the summary in the background: one sentence, one point per
topic, and one thing to watch out for. If the summary fails, the admin shows that and you make it
again with one click.

## Run it locally

You need Node 22 or newer, pnpm, and an Anthropic API key.

```bash
pnpm install
cp .dev.vars.example .dev.vars   # fill in ANTHROPIC_API_KEY, ADMIN_USER and ADMIN_PASS
pnpm db:local                    # create the tables in a local D1 database
pnpm db:seed                     # optional: an example project
pnpm dev                         # http://localhost:3000
```

With the seed in place, open `http://localhost:3000/example/demo` for the interview and
`http://localhost:3000/admin` for the admin. The admin asks for `ADMIN_USER` and `ADMIN_PASS`.

To run it the way it runs on Cloudflare:

```bash
pnpm build
pnpm preview
```

## Set up a project

1. Open `/admin` and choose **New project**.
2. Fill in the organisation and a name, and paste the brief. Write it as an instruction to the
   interviewer: what you need to know by the end, as a list, and how to follow up. The brief in
   `examples/seed.sql` is a template that works.
3. Optionally add topics, one per line. The summary then has exactly one point per topic, with a
   fixed key, so you can compare answers across participants.
4. Set the maximum number of questions, from four to thirty. Twelve is about ten minutes.
5. Add participants, one name per line, and send each person their link. A link without a name
   asks for one at the start.

## Deploy to Cloudflare

Once:

```bash
npx wrangler d1 create hearout              # put the database_id in wrangler.jsonc
pnpm db:remote
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put ADMIN_USER
npx wrangler secret put ADMIN_PASS
```

After that, every time:

```bash
pnpm deploy
```

| Secret | What it is for |
|---|---|
| `ANTHROPIC_API_KEY` | the conversation and the summary |
| `ADMIN_USER` | Basic Auth on `/admin` and `/api/admin` |
| `ADMIN_PASS` | Basic Auth on `/admin` and `/api/admin` |

## What it costs

The model is Claude Opus 5.5 (`MODEL` in `server/utils/claude.ts`). A test interview of four
questions, including its summary, cost about $0.05. A full interview of twelve questions will cost
more, roughly $0.10 to $0.25, depending on the length of your brief and of the answers.

The admin shows an estimate per participant, based on the real token counts. Hover over it to see
how many tokens came from the cache. If that number stays at zero after a few questions, caching
is not working and every turn costs more than it should. A very short brief can fall below the
minimum length the API caches.

## What is stored

Everything a conversation produces is stored in a form you can query with plain SQL. Run queries
with `npx wrangler d1 execute hearout --remote --command "..."`.

| Table | One row per | Main columns |
|---|---|---|
| `projects` | round of interviews | `brief_md`, `topics`, `max_turns` |
| `participants` | link | `status`, `end_reason`, `brief_at_start`, `summary_status` |
| `messages` | question or answer | `turn`, `role`, `text`, `source` (typed or a clicked suggestion), token counts |
| `summaries` | version of a summary | `in_one_sentence`, `watch_out`, `json`, `markdown` |
| `summary_points` | topic in a summary | `key`, `answer`, `discussed` |

Question n and the answer to it share `turn` n. The view `latest_summary` gives the newest summary
per participant.

```sql
-- What did everyone say about integrations?
SELECT j.organisation, p.name, sp.answer
  FROM summary_points sp
  JOIN latest_summary s ON s.id = sp.summary_id
  JOIN participants p ON p.id = s.participant_id
  JOIN projects j ON j.id = p.project_id
 WHERE sp.key = 'integrations';

-- Which topics are skipped most often?
SELECT key, SUM(discussed = 0) AS not_discussed, COUNT(*) AS total
  FROM summary_points GROUP BY key ORDER BY not_discussed DESC;

-- How often does someone click a suggestion instead of typing?
SELECT source, COUNT(*) FROM messages WHERE role = 'participant' GROUP BY source;

-- Does the model wrap up itself, or does it run into the limit?
SELECT end_reason, COUNT(*) FROM participants WHERE status = 'done' GROUP BY end_reason;
```

## How the code is organised

```
migrations/          the D1 schema
examples/seed.sql    an example project with a brief that works
server/utils/        claude.ts (the API call and the schemas), prompts.ts, summary.ts,
                     guards.ts, export.ts, env.ts
server/api/          chat.post.ts (one turn), participant/[code], admin/*
server/middleware/   admin-auth.ts: Basic Auth on the admin
app/pages/           [project]/[code].vue (the interview), admin.vue
```

The stack is Nuxt 4, Tailwind 4, Cloudflare Workers with D1, and the Anthropic SDK.

## Things to know before you build on it

- **Answers have a fixed shape.** The model answers through one strict tool with the fields
  `reply`, `done` and `suggestions`, so the page never has to guess what comes back. A turn
  without a valid tool call is retried.
- **The turn number is not in the system prompt.** It goes in as a system message after the
  history. That keeps the cached part identical from turn to turn.
- **Input is limited and filtered.** An answer has at most 500 characters, and a filter stops
  email addresses and numbers written like a phone number. Amounts, ranges, dates and order
  numbers pass, because the interviewer asks for numbers. The filter is a starting point, not a
  complete check for personal data, and it will miss some phone numbers.
- **The link is the only key.** Anyone with the code can read a running conversation and answer
  in it. The endpoints have no rate limit of their own: add one, for example a Cloudflare
  rate limiting rule on `/api/chat` and `/api/participant/*`, before you send links widely.
- **A finished conversation is closed.** The link no longer shows the transcript, because links
  get forwarded. You read it in the admin.
- **A conversation keeps the brief it started under.** Editing a project does not change
  conversations that are already running.
- **The summary runs in the background.** On Cloudflare that work gets thirty seconds after the
  response, so the background run is one attempt with a time-out of 22 seconds. A summary that
  runs out of time is marked as failed, and the admin button makes it again inside a normal
  request. If the Worker is stopped before it can record anything, the admin reports the summary
  as failed after two minutes.
- **Two tabs on one link do not split the conversation.** The second request fails on a unique
  index and the page asks for a reload. That check comes after the model call, so the losing
  request is paid for. Claiming the turn in the database first would avoid that.
- **Refusals fall back to another model.** The API call sets `fallbacks: "default"`, a beta
  feature of the Anthropic API. Remove the two marked lines in `server/utils/claude.ts` if you do
  not want that.
- **The admin has one login.** Basic Auth with one user is enough for one person. Replace it
  before you share the admin with a team.

## Ideas for what to add

- Email invitations and reminders
- A notification when someone finishes
- Languages other than English, per project
- One shared link per team, where people pick their name
- Editing a project, and reopening a finished conversation
- Streaming the reply as it is written

## License

MIT, see [LICENSE](LICENSE).
