# Render public API deployment

`render.yaml` provisions the first public NestJS environment:

- NestJS web service with an HTTPS `onrender.com` URL
- PostgreSQL database on Render private networking
- Redis-compatible Render Key Value service
- generated authentication and admin secrets
- initial schema bootstrap before every API start
- exact CORS origins for the Sites and GitHub Pages frontends

Deploy from the repository root with:

https://render.com/deploy?repo=https%3A%2F%2Fgithub.com%2Fzhy20022%2F-%2Ftree%2Fmain

The initial Blueprint intentionally uses free trial resources so creation does not
silently incur a charge. Before treating it as a durable production environment,
upgrade PostgreSQL and Key Value to persistent paid plans and enable backups.

After Render reports the API as live, verify:

```text
https://<render-service-host>/api/health/ready
```

Only after that endpoint returns `ok: true` should `GAME_API_ORIGIN` be set on the
Sites project and a new Sites version deployed.

