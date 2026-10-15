# Deploying Aevora on AWS (serverless)

| Part | AWS service |
| --- | --- |
| Website (Aevora-looks-core) | Amplify Hosting, built from GitHub on every push to `main` |
| Uploads and generated media | S3 bucket behind CloudFront |
| API (this repo) | Lambda `aevora-api` with a Function URL. `Dockerfile.lambda` runs the Express app through the AWS Lambda Web Adapter |
| Pipeline worker (AevoraORG-Pipeline) | Lambda `aevora-worker`. The API invokes it when a job is queued; it runs every waiting job and stops |
| Database | RDS PostgreSQL on the free-tier size (`db.t4g.micro`). On a Paid plan account, Aurora Serverless v2 can pause when idle instead (see the end) |

Limits of this setup:
- Uploads are capped at 4MB, because Lambda accepts at most 6MB per request and uploads are base64 JSON.
- A worker run lasts at most 15 minutes. An interrupted guided job resumes its provider operation on the next run.
- The database accepts connections from the internet, protected by a long random password and SSL, because Lambda has no fixed IP address.

Use the region **Asia Pacific (Mumbai) `ap-south-1`** for every service. Keep these values in a private note as you go: `MEDIA_BUCKET`, `MEDIA_CDN`, `DB_PASSWORD`, `DB_ENDPOINT`, `API_URL`, `WEB_URL`, `GOOGLE_CLIENT_ID`, plus the secrets from step 0. Delete anything left over from an earlier attempt (databases, Lambda functions, Amplify apps) so nothing bills twice.

## 0. Generate secrets (on your computer)

```bash
node -e "for (const name of ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET', 'AEVORA_PIPELINE_SERVICE_TOKEN', 'DB_PASSWORD']) console.log(name + '=' + require('crypto').randomBytes(24).toString('hex'))"
```

## 1. Start the database (it takes about 10 minutes, so do it first)

RDS → Databases → Create database:
1. **Full configuration** (Easy create cannot turn on public access).
2. Engine type **PostgreSQL**, newest **17.x** version.
3. Templates: **Free tier**.
4. DB instance identifier `aevora-db`, master username `postgres`, credentials management **Self managed**, master password = `DB_PASSWORD`.
5. Instance configuration: `db.t4g.micro` (preselected).
6. Storage: 20 GiB. Under Additional storage configuration, untick **Enable storage autoscaling**.
7. Connectivity: **Don't connect to an EC2 compute resource**, default VPC, **Public access: Yes**, VPC security group **Create new** named `aevora-db-public`.
8. Database authentication: **Password authentication**.
9. Monitoring: untick **Enhanced Monitoring** if it is ticked.
10. Additional configuration (at the bottom): Initial database name `aevora`.
11. **Create database**, then continue while it starts.

## 2. Media storage (S3 + CloudFront)

1. S3 → Create bucket: **General purpose**, a globally unique name such as `aevora-media-yourname` (`MEDIA_BUCKET`), **Block all public access** left on. Create.
2. CloudFront → Create distribution:
   - Plan: **Pay-as-you-go** (this traffic stays inside CloudFront's always-free allowance).
   - Origin: **Amazon S3**, your bucket. Allow private S3 bucket access to CloudFront (**Origin access control**, recommended); this writes the bucket policy for you.
   - Viewer protocol policy: **Redirect HTTP to HTTPS**.
   - Security protections (WAF): **Do not enable** (WAF is billed separately).
3. Copy the distribution domain name: `MEDIA_CDN` = `https://dxxxx.cloudfront.net`.
4. If a banner asks you to update the S3 bucket policy: **Copy policy** → S3 → bucket → Permissions → Bucket policy → Edit → paste → Save.
5. Distribution → Behaviors → default `(*)` → Edit → Response headers policy **SimpleCORS** → Save (the "Download MP4" button fetches videos from the browser).

## 3. GitHub deploy user (builds the Lambda images)

IAM → Users → Create user `github-deployer` (no console access) → open it → Add permissions → Create inline policy → JSON:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    { "Effect": "Allow", "Action": "ecr:GetAuthorizationToken", "Resource": "*" },
    { "Effect": "Allow",
      "Action": ["ecr:CreateRepository", "ecr:DescribeRepositories", "ecr:PutLifecyclePolicy",
                 "ecr:GetRepositoryPolicy", "ecr:SetRepositoryPolicy",
                 "ecr:BatchCheckLayerAvailability", "ecr:InitiateLayerUpload", "ecr:UploadLayerPart",
                 "ecr:CompleteLayerUpload", "ecr:PutImage", "ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer"],
      "Resource": "arn:aws:ecr:*:*:repository/aevora-*" },
    { "Effect": "Allow", "Action": ["lambda:GetFunction", "lambda:UpdateFunctionCode"],
      "Resource": "arn:aws:lambda:*:*:function:aevora-*" }
  ]
}
```

Name it `aevora-deploy`. Then Security credentials → Create access key (use case "Other"). In **AevoraORG-Backend** and **AevoraORG-Pipeline** on GitHub, add two secrets under Settings → Secrets and variables → Actions: `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`. For a region other than `ap-south-1`, also add the variable `AWS_REGION`.

## 4. Build the images

Merge the deployment code into `main` in all three repositories (the website builds from `main` too). Each push to `main` in this repo and AevoraORG-Pipeline runs "Deploy … to AWS Lambda": it creates the ECR repository (`aevora-api`, `aevora-worker`), builds `Dockerfile.lambda` and pushes it. Wait until both runs are green. Until the functions exist, the last step only prints a notice; afterwards every push to `main` updates its function.

## 5. Finish the database

When `aevora-db` is **Available**:
1. Connectivity & security → copy the **Endpoint** (`DB_ENDPOINT`).
2. Open security group `aevora-db-public` → Inbound rules → Edit → set the PostgreSQL (5432) source to **Anywhere-IPv4**.
3. Create the tables from your computer, inside this repo on `main` (`git pull`, then `npm install`):

```powershell
# Windows PowerShell
$env:DATABASE_URL="postgresql://postgres:DB_PASSWORD@DB_ENDPOINT:5432/aevora?sslmode=require&connect_timeout=30"
npx prisma migrate deploy
```

```bash
# macOS / Linux
DATABASE_URL="postgresql://postgres:DB_PASSWORD@DB_ENDPOINT:5432/aevora?sslmode=require&connect_timeout=30" npx prisma migrate deploy
```

It ends with "All migrations have been successfully applied." If it says database `aevora` does not exist, the initial database name was skipped: use `/postgres` instead of `/aevora` here and in the API's `DATABASE_URL`.

## 6. API Lambda

Lambda → Create function → **Container image** → name `aevora-api` → Browse images → `aevora-api` → the image → **x86_64** → create a new role with basic Lambda permissions.

- Configuration → General configuration: memory **1024 MB**, timeout **1 min**.
- Environment variables:

| Key | Value |
| --- | --- |
| `DATABASE_URL` | `postgresql://postgres:DB_PASSWORD@DB_ENDPOINT:5432/aevora?sslmode=require&connection_limit=3&connect_timeout=30&pool_timeout=30` |
| `GOOGLE_CLIENT_ID` | your Google web client ID |
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `AEVORA_PIPELINE_SERVICE_TOKEN` | from step 0 |
| `FRONTEND_ORIGIN` | `http://localhost:5173` for now (step 9 replaces it) |
| `STORAGE_DRIVER` | `s3` |
| `S3_BUCKET` / `S3_REGION` | `MEDIA_BUCKET` / `ap-south-1` |
| `STORAGE_PUBLIC_BASE_URL` | `MEDIA_CDN` |
| `WORKER_FUNCTION_NAME` | `aevora-worker` |

- Configuration → Permissions → role name → Add permissions → Create inline policy → JSON (`ACCOUNT_ID` is the 12-digit number in the top-right menu):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    { "Effect": "Allow", "Action": "s3:PutObject", "Resource": "arn:aws:s3:::MEDIA_BUCKET/*" },
    { "Effect": "Allow", "Action": "lambda:InvokeFunction", "Resource": "arn:aws:lambda:ap-south-1:ACCOUNT_ID:function:aevora-worker" }
  ]
}
```

- Configuration → Function URL → Create → Auth type **NONE**, CORS **unticked** (the app handles CORS) → `API_URL`. `API_URL/api/health` should show `{"status":"ok"...}`.

## 7. Worker Lambda

Create function → Container image → `aevora-worker` → the image → x86_64 → new basic role.

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

- Permissions: inline policy allowing `s3:PutObject` on `arn:aws:s3:::MEDIA_BUCKET/*`. The worker needs no Function URL.

## 8. Website (Amplify)

Amplify → Create new app → GitHub → authorize → `Aevora-looks-core`, branch `main`. The build uses `amplify.yml`. Under Advanced settings → environment variables, add `VITE_API_BASE_URL` = `API_URL` and `VITE_GOOGLE_CLIENT_ID` = `GOOGLE_CLIENT_ID`. Save and deploy, then copy `WEB_URL` (`https://main.xxxx.amplifyapp.com`).

Hosting → Rewrites and redirects → Manage redirects → text editor:

```json
[{ "source": "/<*>", "target": "/index.html", "status": "404-200" }]
```

## 9. Connect the pieces

- Lambda `aevora-api` → Environment variables → `FRONTEND_ORIGIN` = `WEB_URL` (comma-separate extra origins, e.g. `WEB_URL,http://localhost:5173`).
- Google Cloud Console → APIs & Services → Credentials → your web OAuth client → Authorized JavaScript origins → add `WEB_URL`. If the consent screen is in Testing, add your account as a test user.

## 10. Test end to end

1. `API_URL/api/health` returns `{"status":"ok"...}`.
2. Open `WEB_URL` and sign in with Google.
3. Create a project and a guided ad, and upload a product image of at most 4MB; its preview loads from CloudFront.
4. Generate the script: the job goes Queued → Running → Succeeded within about a minute (the first run includes cold starts). Approve it, then generate and approve the storyboard.
5. For clips and the final MP4, switch the worker to real providers (step 11). Keyframes can be uploaded per shot, or generated with a RunPod image endpoint. Then generate the clips, approve the timeline and export; the MP4 plays and downloads.

Logs: Lambda → Monitor → View CloudWatch logs.

| Problem | Fix |
| --- | --- |
| `API_URL` returns 403 Forbidden | Configuration → Permissions → Resource-based policy must allow both `lambda:InvokeFunctionUrl` and `lambda:InvokeFunction` for everyone; the console adds both when you create the URL with auth type NONE. Delete and recreate the Function URL if one is missing |
| Google says the origin is not allowed | Step 9 Google origin (can take a few minutes) |
| CORS / "Failed to fetch" errors | `FRONTEND_ORIGIN` must match `WEB_URL` |
| Sign-in fails | `aevora-api` logs: check `DATABASE_URL`, public access and the security group rule |
| A job stays queued | `aevora-worker` logs; the API role needs `lambda:InvokeFunction`; `WORKER_FUNCTION_NAME` set |
| Worker logs show `401` | `AEVORA_PIPELINE_SERVICE_TOKEN` must be identical on both functions |
| Refreshing a page gives 404 | Step 8 rewrite rule |

## 11. Real generation

Mock mode writes scripts and storyboards but cannot generate clips. On `aevora-worker`, set `PIPELINE_PROVIDER_MODE` and the matching keys; any non-mock mode writes scripts with `OPENROUTER_API_KEY`:

| Mode | Keys |
| --- | --- |
| `ltx` | `LTX_API_KEY` |
| `fal` | `FAL_KEY` |
| `google` | `GEMINI_API_KEY` |
| `modal` | your `MODAL_LTX_*` values |
| `runpod` | `RUNPOD_API_KEY`, `RUNPOD_ENDPOINT_ID` |

For generated keyframes add `PIPELINE_IMAGE_PROVIDER=runpod` and `RUNPOD_KEYFRAME_ENDPOINT_ID`. Environment changes apply to the next job.

## Costs

The database is the only part that runs all the time (about $25 a month at Mumbai prices on the free-tier size; on the AWS Free plan it is paid from credits). Lambda, CloudFront and the first S3 gigabytes stay inside AWS's free allowances at this scale. Stop the database (Actions → Stop temporarily) when you are not using the app, and set an AWS Budgets alert.

On a Paid plan account you can use Aurora Serverless v2 instead, which pauses when idle: Engine **Aurora (PostgreSQL Compatible)**, Template Dev/Test, Instance configuration **Serverless v2** with minimum **0** and maximum **1** ACU, no Aurora Replica, and the same credentials, connectivity and initial database name. Free plan accounts only get Aurora with express configuration, which signs in with IAM tokens instead of the password this app uses.
