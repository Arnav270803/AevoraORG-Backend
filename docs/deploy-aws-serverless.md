# Deploying Aevora on AWS (serverless)

Nothing runs while nobody uses the app, except the database's storage.

| Part | AWS service |
| --- | --- |
| Website (Aevora-looks-core) | Amplify Hosting, built from GitHub on every push to `main` |
| Uploads and generated media | S3 bucket + CloudFront |
| API (this repo) | Lambda `aevora-api` with a Function URL. `Dockerfile.lambda` runs the Express app through the AWS Lambda Web Adapter |
| Pipeline worker (AevoraORG-Pipeline) | Lambda `aevora-worker`. The API invokes it when a job is queued; it runs every waiting job and stops |
| Database | Aurora Serverless v2 (PostgreSQL), minimum 0 ACUs, so it pauses when idle. On a Free plan account, RDS PostgreSQL on the free-tier size (see step 3) |

Limits of this setup:
- The first request after a quiet period takes about 15-20 seconds while the database resumes.
- Uploads are capped at 4MB, because Lambda accepts at most 6MB per request and uploads are base64 JSON.
- A worker run lasts at most 15 minutes. An interrupted guided job resumes its provider operation on the next run. Long jobs in the old "Automatic" mode may not finish.
- The database accepts connections from the internet, protected by a long random password and SSL, because the Lambdas need internet access for Google sign-in and the AI providers.

All values below assume region `ap-south-1` (Mumbai). Collect these as you go: `ACCOUNT_ID` (12 digits, top-right menu in the console), `MEDIA_BUCKET`, `MEDIA_CDN`, `DB_ENDPOINT`, `API_URL`, `WEB_URL`, `GOOGLE_CLIENT_ID`.

## 0. Generate secrets (on your computer)

```bash
node -e "for (const name of ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET', 'AEVORA_PIPELINE_SERVICE_TOKEN', 'DB_PASSWORD']) console.log(name + '=' + require('crypto').randomBytes(24).toString('hex'))"
```

## 1. GitHub deploy user (builds the Lambda images)

IAM → Users → Create user `github-deployer` (no console access) → open it → Add permissions → Create inline policy → JSON:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    { "Effect": "Allow", "Action": "ecr:GetAuthorizationToken", "Resource": "*" },
    { "Effect": "Allow",
      "Action": ["ecr:CreateRepository", "ecr:DescribeRepositories", "ecr:PutLifecyclePolicy",
                 "ecr:BatchCheckLayerAvailability", "ecr:InitiateLayerUpload", "ecr:UploadLayerPart",
                 "ecr:CompleteLayerUpload", "ecr:PutImage", "ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer"],
      "Resource": "arn:aws:ecr:*:*:repository/aevora-*" },
    { "Effect": "Allow", "Action": ["lambda:GetFunction", "lambda:UpdateFunctionCode"],
      "Resource": "arn:aws:lambda:*:*:function:aevora-*" }
  ]
}
```

Security credentials → Create access key (use case "Other"). In **AevoraORG-Backend** and **AevoraORG-Pipeline** on GitHub, add two secrets under Settings → Secrets and variables → Actions: `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`. If you use another region, also add the variable `AWS_REGION` there.

## 2. Build the images

Push to `main` in both repos (or Actions → "Deploy … to AWS Lambda" → Run workflow). Each workflow creates its ECR repository (`aevora-api`, `aevora-worker`), builds `Dockerfile.lambda` and pushes it. Until the functions exist, the last step only prints a notice. After that, every push to `main` updates its function automatically.

## 3. Database

RDS → Create database → **Full configuration**. Easy create cannot turn on public access, and the express configuration only accepts IAM tokens, not the password the app uses.
- Engine: **Aurora (PostgreSQL Compatible)**, newest version offered. Template: Dev/Test.
- Cluster identifier `aevora-db`, master username `postgres`, credentials **Self managed**, password = `DB_PASSWORD`.
- Instance configuration: **Serverless v2**, minimum **0** ACUs, maximum **1** ACU, pause after inactivity **10 minutes**.
- No Aurora Replica. Connectivity: default VPC, **Public access: Yes**, new security group `aevora-db-public`.
- Additional configuration: initial database name `aevora`, deletion protection on. Leave Enhanced Monitoring off.

On an AWS **Free plan** account, Aurora is only offered with express configuration, and only the free-tier size of the other engines can be chosen. Either upgrade to the Paid plan first (remaining credits carry over), or create a regular database: Engine **PostgreSQL**, Template **Free tier** (db.t4g.micro), storage autoscaling off, and the same credentials, connectivity and initial database name. Everything else in this guide stays the same. That database runs all the time instead of pausing, about $25 a month at Mumbai prices, paid from credits while they last.

When it is Available:
1. Copy the **writer endpoint** (Aurora) or the **endpoint** (PostgreSQL) as `DB_ENDPOINT`.
2. Open security group `aevora-db-public` → Inbound rules → set the PostgreSQL (5432) source to **Anywhere-IPv4**. Lambda has no fixed IP address.

```text
DATABASE_URL=postgresql://postgres:DB_PASSWORD@DB_ENDPOINT:5432/aevora?sslmode=require&connection_limit=3&connect_timeout=30&pool_timeout=30
```

Create the tables from your computer, inside this repo (`git pull` first, then `npm install`):

```powershell
# Windows PowerShell
$env:DATABASE_URL="postgresql://postgres:DB_PASSWORD@DB_ENDPOINT:5432/aevora?sslmode=require&connect_timeout=30"
npx prisma migrate deploy
```

```bash
# macOS / Linux
DATABASE_URL="postgresql://postgres:DB_PASSWORD@DB_ENDPOINT:5432/aevora?sslmode=require&connect_timeout=30" npx prisma migrate deploy
```

## 4. Media bucket

S3 bucket private (Block all public access on). CloudFront distribution with **Origin access control**, Viewer protocol policy **Redirect HTTP to HTTPS**, and on the default behavior the response headers policy **SimpleCORS** (the "Download MP4" button fetches videos from the browser). `MEDIA_CDN` = `https://dxxxx.cloudfront.net`, no trailing slash.

## 5. API Lambda

Lambda → Create function → **Container image** → name `aevora-api` → Browse images → `aevora-api` → newest image → x86_64 → create a new role with basic Lambda permissions.

- General configuration: memory **1024 MB**, timeout **1 min**.
- Environment variables:

| Key | Value |
| --- | --- |
| `DATABASE_URL` | the URL from step 3 |
| `GOOGLE_CLIENT_ID` | your Google web client ID |
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `AEVORA_PIPELINE_SERVICE_TOKEN` | from step 0 |
| `FRONTEND_ORIGIN` | `http://localhost:5173` for now (step 8 replaces it) |
| `STORAGE_DRIVER` | `s3` |
| `S3_BUCKET` / `S3_REGION` | `MEDIA_BUCKET` / `ap-south-1` |
| `STORAGE_PUBLIC_BASE_URL` | `MEDIA_CDN` |
| `WORKER_FUNCTION_NAME` | `aevora-worker` |

- Permissions → role → Add permissions → Create inline policy → JSON:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    { "Effect": "Allow", "Action": "s3:PutObject", "Resource": "arn:aws:s3:::MEDIA_BUCKET/*" },
    { "Effect": "Allow", "Action": "lambda:InvokeFunction", "Resource": "arn:aws:lambda:ap-south-1:ACCOUNT_ID:function:aevora-worker" }
  ]
}
```

- Function URL → Create → Auth type **NONE**, leave CORS **unchecked** (the app handles CORS) → `API_URL`. Opening `API_URL/api/health` should show `{"status":"ok"...}`.

## 6. Worker Lambda

Create function → Container image → `aevora-worker` → newest image → x86_64 → new basic role.

- General configuration: memory **3008 MB**, ephemeral storage **2048 MB**, timeout **15 min**.
- Environment variables:

| Key | Value |
| --- | --- |
| `BACKEND_URL` | `API_URL` |
| `AEVORA_PIPELINE_SERVICE_TOKEN` | same as the API |
| `PIPELINE_PROVIDER_MODE` | `mock` to start |
| `PIPELINE_STORAGE_DRIVER` | `s3` |
| `PIPELINE_LOCAL_OUTPUT_PUBLIC_BASE_URL` | `MEDIA_CDN` |
| `S3_BUCKET` / `S3_REGION` | `MEDIA_BUCKET` / `ap-south-1` |

- Permissions: inline policy allowing `s3:PutObject` on `arn:aws:s3:::MEDIA_BUCKET/*`.

## 7. Website (Amplify)

Amplify → Create new app → GitHub → `Aevora-looks-core`, branch `main`. The build uses `amplify.yml`. Under Advanced settings → environment variables, add `VITE_API_BASE_URL` = `API_URL` and `VITE_GOOGLE_CLIENT_ID` = `GOOGLE_CLIENT_ID`. Save and deploy, then copy `WEB_URL` (`https://main.xxxx.amplifyapp.com`).

Hosting → Rewrites and redirects → Manage → text editor:

```json
[{ "source": "/<*>", "target": "/index.html", "status": "404-200" }]
```

## 8. Connect the pieces

- Lambda `aevora-api` → Environment variables → `FRONTEND_ORIGIN` = `WEB_URL` (comma-separate extra origins, e.g. `WEB_URL,http://localhost:5173`).
- Google Cloud Console → APIs & Services → Credentials → your web OAuth client → Authorized JavaScript origins → add `WEB_URL`. If the consent screen is in Testing, add your account as a test user.

## 9. Check it

Open `WEB_URL`, sign in, create an ad with an image of at most 4MB, open the script workspace and generate a script. Logs: Lambda → Monitor → View CloudWatch logs.

| Problem | Fix |
| --- | --- |
| Google says the origin is not allowed | Step 8 Google origin |
| CORS / "Failed to fetch" errors | `FRONTEND_ORIGIN` must match `WEB_URL` exactly |
| Sign-in fails | `aevora-api` logs: check `DATABASE_URL`, public access and the security group |
| A job stays queued | `aevora-worker` logs; API role needs `lambda:InvokeFunction`; `WORKER_FUNCTION_NAME` set |
| Worker logs show `401` | `AEVORA_PIPELINE_SERVICE_TOKEN` must be identical on both functions |

## 10. Real generation

Mock mode writes scripts and storyboards but cannot generate clips. On `aevora-worker`, set `PIPELINE_PROVIDER_MODE=ltx` with `LTX_API_KEY` and `OPENROUTER_API_KEY`, or `modal` with your `MODAL_LTX_*` values. Environment changes apply to the next run.

Set an AWS Budgets alert (Billing → Budgets) so spending never surprises you.
