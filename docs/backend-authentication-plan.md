# Backend Authentication Plan: Google Sign-In + JWT

## Goal

Build authentication for Aevora using Google Sign-In as the identity provider and Aevora-issued JWTs for app sessions.

The first backend milestone should do only authentication:

- Let users sign in with Google.
- Verify the Google identity token on the backend.
- Create or update the local Aevora user.
- Issue Aevora access and refresh JWTs.
- Protect backend routes with the access JWT.
- Support logout and token refresh.

## Recommended Auth Flow

For the current React web app, use Google Identity Services on the frontend and token verification on the backend.

1. Frontend renders a Google Sign-In button.
2. Google returns an ID token to the frontend in the `credential` field.
3. Frontend sends that credential to the backend:

   ```http
   POST /api/auth/google
   ```

4. Backend verifies the Google ID token using Google's official Node auth library.
5. Backend reads the verified claims, especially:

   - `sub`: stable Google account ID. Use this as the provider identifier.
   - `email`
   - `email_verified`
   - `name`
   - `picture`

6. Backend upserts a local user record.
7. Backend issues Aevora JWTs:

   - Short-lived access token.
   - Longer-lived refresh token.

8. Frontend stores the session and calls protected APIs with the access token.

This keeps Google responsible for identity verification and keeps Aevora responsible for app authorization.

## Why This Flow

Use Google ID tokens only to prove who the user is. Do not use Google tokens as the app session.

Aevora should issue its own JWTs because we will need app-specific claims later:

- Aevora user ID
- workspace/team ID
- plan or subscription tier
- onboarding status
- role/permissions
- token version for logout/revocation

Google's documentation also recommends verifying ID tokens server-side and using the Google `sub` claim as the stable user identifier. Email can change, so it should not be the primary identifier.

## Backend Endpoints

### `POST /api/auth/google`

Purpose: Complete Google sign-in.

Request:

```json
{
  "credential": "GOOGLE_ID_TOKEN"
}
```

Backend behavior:

1. Verify the Google ID token.
2. Ensure `aud` matches `GOOGLE_CLIENT_ID`.
3. Ensure issuer is Google.
4. Ensure token is not expired.
5. Read `sub`, `email`, `email_verified`, `name`, and `picture`.
6. Reject sign-in if `email_verified` is false.
7. Find or create user by provider:

   ```text
   provider = "google"
   providerUserId = google sub
   ```

8. Update profile fields if changed.
9. Issue app tokens.
10. Return user profile plus session tokens.

Response:

```json
{
  "user": {
    "id": "user_uuid",
    "email": "user@example.com",
    "name": "User Name",
    "avatarUrl": "https://..."
  },
  "accessToken": "AEVORA_ACCESS_JWT",
  "refreshToken": "AEVORA_REFRESH_JWT"
}
```

### `POST /api/auth/refresh`

Purpose: Exchange a valid refresh token for a new access token.

Request:

```json
{
  "refreshToken": "AEVORA_REFRESH_JWT"
}
```

Backend behavior:

1. Verify refresh JWT signature and expiry.
2. Check that token is still active in storage.
3. Rotate refresh token if we want stronger security.
4. Return new access token and refresh token.

### `POST /api/auth/logout`

Purpose: End the app session.

Request:

```json
{
  "refreshToken": "AEVORA_REFRESH_JWT"
}
```

Backend behavior:

1. Revoke or delete the refresh token record.
2. Return success.

### `GET /api/auth/me`

Purpose: Return the current authenticated user.

Authorization:

```http
Authorization: Bearer AEVORA_ACCESS_JWT
```

Backend behavior:

1. Verify access JWT.
2. Load user by `sub` claim or local user ID claim.
3. Return user profile.

## JWT Design

### Access Token

Recommended expiry: 15 minutes.

Claims:

```json
{
  "sub": "local_user_uuid",
  "email": "user@example.com",
  "role": "user",
  "tokenType": "access",
  "iat": 1710000000,
  "exp": 1710000900
}
```

Use for API authorization only. Keep it short-lived.

### Refresh Token

Recommended expiry: 7 to 30 days.

Claims:

```json
{
  "sub": "local_user_uuid",
  "tokenType": "refresh",
  "jti": "refresh_token_uuid",
  "iat": 1710000000,
  "exp": 1712592000
}
```

Store refresh token records server-side so they can be revoked.

Recommended storage fields:

- `id`
- `userId`
- `tokenHash`
- `expiresAt`
- `revokedAt`
- `createdAt`
- `lastUsedAt`
- `userAgent`
- `ipAddress`

Never store raw refresh tokens in the database. Store a hash.

## Database Model

Initial tables:

### `users`

```text
id
email
emailVerified
name
avatarUrl
createdAt
updatedAt
lastLoginAt
```

### `auth_accounts`

```text
id
userId
provider
providerUserId
createdAt
updatedAt
```

Constraints:

- Unique `(provider, providerUserId)`
- Unique `email` if we are comfortable with one Aevora account per email

### `refresh_tokens`

```text
id
userId
tokenHash
expiresAt
revokedAt
createdAt
lastUsedAt
userAgent
ipAddress
```

## Environment Variables

```env
GOOGLE_CLIENT_ID=
JWT_ACCESS_SECRET=
JWT_REFRESH_SECRET=
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=30d
FRONTEND_ORIGIN=http://localhost:5173
BACKEND_URL=http://localhost:4000
```

For production:

- Use strong random secrets.
- Do not reuse access and refresh secrets.
- Keep secrets out of Git.
- Configure production Google OAuth origins and redirect settings.

## Frontend Integration Plan

Add Google Identity Services script to the app.

Frontend responsibilities:

1. Render Google Sign-In button.
2. Receive Google `credential`.
3. Send credential to `POST /api/auth/google`.
4. Store returned app tokens.
5. Call protected APIs with:

   ```http
   Authorization: Bearer ACCESS_TOKEN
   ```

6. Refresh access token when expired.
7. Logout by calling `POST /api/auth/logout`.

Storage decision:

- MVP option: keep tokens in memory plus localStorage for persistence.
- Safer option: store refresh token in an HttpOnly secure cookie and keep access token in memory.

Recommended path: use HttpOnly secure cookie for refresh token once backend and deployment domain are stable.

## Backend Middleware

Create an auth middleware:

1. Read `Authorization` header.
2. Require `Bearer <token>`.
3. Verify access JWT.
4. Ensure `tokenType === "access"`.
5. Attach authenticated user to request context.
6. Continue to protected route.

Example protected route groups:

- `/api/user/*`
- `/api/projects/*`
- `/api/ads/*`
- `/api/workflow/*`

## Security Rules

- Always verify Google ID tokens on the backend.
- Validate Google token `aud`, `iss`, and `exp`.
- Use Google `sub` as the provider account ID, not email.
- Reject unverified emails for MVP.
- Use HTTPS in production.
- Allow only trusted frontend origins in CORS.
- Use short-lived access tokens.
- Store refresh token hashes, not raw refresh tokens.
- Add rate limiting to auth endpoints.
- Rotate refresh tokens after use if feasible.
- Add logout by revoking refresh tokens.
- Never expose Google client secret to the frontend.

## CSRF Notes

If the frontend sends Google credentials directly to `POST /api/auth/google` using JSON and stores JWTs manually, CSRF risk is lower than a cookie-only session flow, but CORS must still be strict.

If we use HttpOnly cookies for refresh tokens, add CSRF protection for state-changing auth endpoints.

For Google Identity Services form posts, Google documents a double-submit cookie pattern using `g_csrf_token`. If we use that form-post mode later, the backend must compare the CSRF token in the cookie and request body.

## Implementation Order

1. Pick backend stack and folder structure.
2. Add environment config.
3. Add database models for users, auth accounts, and refresh tokens.
4. Implement Google token verification service.
5. Implement JWT signing and verification service.
6. Implement `POST /api/auth/google`.
7. Implement auth middleware.
8. Implement `GET /api/auth/me`.
9. Implement refresh token flow.
10. Implement logout.
11. Connect frontend Google button.
12. Add basic tests for token verification, refresh, logout, and protected routes.

## Suggested Backend Stack

Because this repo already uses Bun and TypeScript, a simple first backend can be:

- Runtime: Bun
- Server: Hono or Express
- Database ORM: Prisma
- Database: PostgreSQL
- Google verification: `google-auth-library`
- JWT library: `jose`
- Password auth: not included in this milestone

If we want the fastest MVP, use Hono with Bun. If we want the most familiar ecosystem, use Express.

## Open Decisions

- Backend framework: Hono, Express, Fastify, or another option.
- Database: PostgreSQL, Supabase Postgres, or another hosted DB.
- Token storage: localStorage MVP or HttpOnly refresh cookie.
- Refresh token rotation: immediate or after MVP.
- Account linking: what happens if a user already exists with the same email from another auth provider later.
- Workspace/team model: whether user signs into a personal account first or a workspace context.

## Official References

- Google Identity Services: Verify the Google ID token on your server side  
  https://developers.google.com/identity/gsi/web/guides/verify-google-id-token

- Google OpenID Connect claims and ID token guidance  
  https://developers.google.com/identity/openid-connect/openid-connect

- Google OAuth 2.0 for Web Server Applications  
  https://developers.google.com/identity/protocols/oauth2/web-server
