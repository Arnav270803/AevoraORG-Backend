# Aevora Backend

Express + TypeScript backend scaffold for the first Aevora authentication milestone.

## Stack

- Runtime: Node.js
- Server: Express
- Language: TypeScript, compiled to JavaScript in `dist`
- Database ORM: Prisma
- Database: PostgreSQL
- Google identity verification: `google-auth-library`
- JWTs: `jose`
- Request validation: `zod`

## Structure

```text
Aevora_Backend/
  docs/
  prisma/
    schema.prisma
  src/
    app.ts
    server.ts
    config/
    constants/
    db/
    middleware/
    modules/
      auth/
      users/
      health/
      projects/
      ads/
      workflow/
    types/
    utils/
  tests/
    integration/
    unit/
```

## First Milestone

The first backend milestone should focus on Google Sign-In, local user creation, Aevora access and refresh JWTs, protected routes, refresh, and logout.

Copy `.env.example` to `.env`, fill in secrets, then install dependencies before running the backend.

## Implemented Auth APIs

### `GET /api/health`

Returns a basic service health response.

### `POST /api/auth/google`

Completes Google Sign-In.

Request:

```json
{
  "credential": "GOOGLE_ID_TOKEN_FROM_FRONTEND"
}
```

Response:

```json
{
  "user": {
    "id": "local-user-id",
    "email": "user@example.com",
    "name": "User Name",
    "avatarUrl": "https://..."
  },
  "accessToken": "AEVORA_ACCESS_JWT",
  "refreshToken": "AEVORA_REFRESH_JWT"
}
```

### `POST /api/auth/refresh`

Rotates a refresh token and returns a new access token plus refresh token.

Request:

```json
{
  "refreshToken": "AEVORA_REFRESH_JWT"
}
```

### `POST /api/auth/logout`

Revokes the submitted refresh token.

Request:

```json
{
  "refreshToken": "AEVORA_REFRESH_JWT"
}
```

### `GET /api/auth/me`

Returns the authenticated user.

Header:

```http
Authorization: Bearer AEVORA_ACCESS_JWT
```

## Required Setup Values

Fill these in `.env` before running locally:

- `DATABASE_URL`: PostgreSQL connection string.
- `GOOGLE_CLIENT_ID`: Google Identity Services web client ID.
- `JWT_ACCESS_SECRET`: strong random secret, at least 32 characters.
- `JWT_REFRESH_SECRET`: different strong random secret, at least 32 characters.
- `FRONTEND_ORIGIN`: local frontend origin, likely `http://localhost:5173`.
- `BACKEND_URL`: local backend URL, likely `http://localhost:4000`.

Then run:

```bash
npm install
npm run prisma:generate
npm run prisma:migrate
npm run dev
```

## Local Docker Database

The local database runs Postgres in Docker and matches the default `DATABASE_URL` in `.env.example`:

```env
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/aevora
```

Start the database:

```bash
npm run db:up
```

Apply Prisma migrations:

```bash
npm run prisma:migrate
```

Useful database commands:

```bash
npm run db:logs
npm run db:down
npm run db:reset
```

`db:reset` removes the Docker volume and deletes local database data.
