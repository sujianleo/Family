# Self-hosted Supabase Deployment

This deployment model is designed for a NAS or a computer that stays online at home. The database, accounts, and files remain on your own device; phones only need to share the same local network as the NAS.

## One-command installation

Install Docker Compose 2.20 or later, Git, and OpenSSL. From the project directory, run the single setup entry point:

```bash
./start.sh
```

`start.sh` runs the internal `scripts/setup-local-supabase.sh` automatically. You do not need to invoke the initialization script or start Supabase separately. Family and Supabase are ultimately started and managed together by the root `docker-compose.yml` project.

The script will:

1. Detect the NAS address on the local network.
2. Download a pinned version of the official Supabase Docker configuration.
3. Generate a database password, JWT secrets, an anonymous key, and a server key.
4. Start local services including Auth, Postgres, and Storage.
5. Create the tables, permissions, and storage buckets required by Family.
6. Build and start Family.

After the first initialization, manage every container from the project directory:

```bash
docker compose ps
docker compose stop
docker compose up -d
```

If the NAS cannot reach Docker Hub, provide an accessible mirror for the Node base image during the first run:

```bash
FAMILY_APP_NODE_IMAGE=docker.m.daocloud.io/library/node:22-alpine ./start.sh
```

Generated Supabase files live in `.runtime/local-supabase`. Application connection settings are written to the Git-ignored `.env` file. Secrets are never committed to the repository.

You do not need to enter `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, or `SUPABASE_SERVICE_ROLE_KEY` manually. The script generates deployment-specific values and writes them to local configuration. The browser receives only the anonymous key; the service-role key remains on the server.

## Local-network access

Assume the NAS address is `192.168.1.20`:

- Family: `http://192.168.1.20:3000`
- Supabase API: `http://192.168.1.20:8000`

Phones, tablets, and computers on the same network can open the Family URL directly. If setup detects the wrong network interface, specify the address:

```bash
FAMILY_APP_HOST=192.168.1.20 ./start.sh
```

Ports can also be changed:

```bash
FAMILY_APP_PORT=3100 SUPABASE_API_PORT=8100 FAMILY_APP_HOST=192.168.1.20 ./start.sh
```

Allow the selected ports through the NAS firewall, but never expose the database port directly to the internet.

## First-time setup

The first visit to an empty database shows **Create a family**. After you enter a name, family name, phone number, and password, the system creates all of the following in one transaction:

- the administrator account;
- the family;
- the administrator membership;
- the family core space and its access permissions.

This entry point can succeed only once. Later members join through invitations and administrator approval. Approved members are added to the family core space automatically.

## Automatic switching between local and public access

When opened from `localhost`, a private IP, or a `.local` hostname, the browser uses the current host with the configured Supabase port. When opened from a normal public domain, it uses `NEXT_PUBLIC_SUPABASE_PUBLIC_URL`. The public URL may remain empty. Setup derives the local address and you can change it later under **Settings → Network**.

Automatic mode checks both public and local endpoints. If only the local endpoint works, it selects local access. If both work, it selects the lower-latency route. You can also pin the app temporarily to **Internet** or **Local**.

![Automatic local and public routing topology](assets/local-supabase-mobile.png)

[Mermaid source](local-supabase-mobile.mmd)

Public access requires HTTPS for both the application and the Supabase API. Provide both public URLs before setup:

```bash
FAMILY_APP_PUBLIC_URL=https://family.example.com \
FAMILY_APP_SUPABASE_PUBLIC_URL=https://data.example.com \
FAMILY_APP_HOST=192.168.1.20 \
./start.sh
```

The public reverse proxy should forward the Family application and Supabase API separately. A local-only deployment does not send its data to hosted Supabase.

## AI is optional

Without an AI provider, sign-in, invitations, group chats, tasks, completion feedback, and resources remain available. The interface simply asks users to connect an API when an AI-only feature is requested.

For a test or household deployment, place `DEEPSEEK_API_KEY` in the server-side `.env`. You can also choose a provider and test it under **Settings → AI**.

DeepSeek's **Test API** button sends a real structured request. If the settings card has no key, the test tries the server-side configuration. If neither location has a key, it returns a clear failure. Never place a server key in a `NEXT_PUBLIC_*` variable.

## Family collaboration flow

![Family invitation and collaboration flow](assets/family-collaboration-mobile.png)

[Mermaid source](family-collaboration-mobile.mmd)

## Backups

Back up at least:

- `.runtime/local-supabase/docker/volumes/db/data`
- `.runtime/local-supabase/docker/volumes/storage`
- the Docker volume referenced by `SUPABASE_DB_CONFIG_VOLUME` in `.env`
- the root `.env` file

The `db-config` volume contains the root key required for database encryption. Upgrades reuse it automatically, so do not delete it casually. The `.env` file contains server secrets and should be stored in encrypted form. Before an upgrade or restore, stop writes and verify that the backup can actually be restored.
