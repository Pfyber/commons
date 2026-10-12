# Running Commons for real

Everything runs on one server with Docker: Caddy (HTTPS and the client), the
four services, Postgres and nightly backups. A small VPS (2 vCPU, 4 GB RAM)
holds the launch comfortably. The 500-bot load test runs at a 3 ms tick.

## 1. Before you start

- **A server** with Docker and the compose plugin, e.g. Hetzner CX22 or a
  DigitalOcean droplet. Pick an EU region (spec §12: EU hosting). Open ports
  80 and 443.
- **A domain**, with an A (and AAAA) record pointing at the server.
- **An SMTP provider** for sign-in emails, e.g. Postmark, Brevo, Amazon SES
  or Mailgun. Verify your sending domain there (SPF and DKIM), or the links
  land in spam.

## 2. Configure

```sh
git clone <this repo> commons && cd commons
cp infra/prod/.env.example infra/prod/.env
openssl rand -hex 32   # → COMMONS_SECRET
openssl rand -hex 16   # → POSTGRES_PASSWORD
nano infra/prod/.env   # domain, SMTP, your email as Caretaker
```

## 3. Start

```sh
docker compose -f infra/prod/docker-compose.yml --env-file infra/prod/.env up -d --build
docker compose -f infra/prod/docker-compose.yml logs -f api
```

The first build takes about 10 minutes. Look for `mailer ready` in the API
log. Then open `https://your-domain`, sign in with your Caretaker email, and
check that the Town Hall shows the **Caretaker** tab.

## 4. Updating

```sh
git pull
docker compose -f infra/prod/docker-compose.yml --env-file infra/prod/.env up -d --build
```

Migrations run automatically when the API starts. Players see "Commons was
updated, reload" when the protocol changes.

## Backups

A dump runs at startup and then every 24 hours into `infra/prod/backups/`,
keeping the last 14. Copy them off the server too (rsync, or your host's
snapshots). To restore:

```sh
gunzip -c infra/prod/backups/commons-YYYYMMDD-HHMM.sql.gz | \
  docker compose -f infra/prod/docker-compose.yml exec -T postgres psql -U commons commons
```

## Health

- `docker compose ps`: every service should say `healthy`.
- `curl https://your-domain/api/founders` is a public endpoint and should
  return JSON.
- Only `/api/*` and `/ws` are public. `/internal`, `/metrics` and the zone's
  `/debug` stay inside the Docker network.

## Launch day checklist

1. Sign in yourself, walk the park, and catch a fish to check that the email
   arrives and the economy works.
2. Do the Caretaker's three tasks, so the first seedling in the Founders'
   Grove is yours (Founder #1).
3. Invite people for an **Evening at the fountain**: daily at 18:00 UTC
   (20:00 CEST). Players see it in their own time zone in the Caretaker's
   panel.
4. Once a few people have 3 active days, open **Name the town** at the Town
   Hall (Caretaker tab).
5. Keep an eye on the report queue in the Caretaker tab.
