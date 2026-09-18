import { randomUUID } from "node:crypto";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

// Deferred integration suite. It does not start a server, Docker or a worker.
// Run later only against an isolated migrated TEST database with no paid worker:
// GUIDED_TEST_ALLOW_WRITES=1, GUIDED_TEST_BASE_URL, GUIDED_TEST_ACCESS_TOKEN.
const enabled = process.env.GUIDED_TEST_ALLOW_WRITES === "1";
const suite = enabled ? describe : describe.skip;
const baseUrl = (process.env.GUIDED_TEST_BASE_URL ?? "http://localhost:4000/api").replace(/\/$/, "");
const token = process.env.GUIDED_TEST_ACCESS_TOKEN;

type Revision = { id: string; artifactId: string; version: number; content: Record<string, unknown> };
type Artifact = { id: string; kind: string; shotId?: string | null; currentRevisionId: string | null; approvedRevisionId: string | null };
type Workspace = { artifacts: Artifact[]; revisions: Revision[]; shots: Array<{ id: string }>; jobs: unknown[] };

async function request(path: string, method = "GET", body?: unknown) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  const data = await response.json() as Record<string, unknown>;
  return { status: response.status, data };
}

const script = (text = "Discover the product.") => ({
  voiceover: [{ id: "10000000-0000-4000-8000-000000000001", startSecond: 0, endSecond: 5, text, delivery: "warm" }],
  captions: [{ id: "10000000-0000-4000-8000-000000000002", startSecond: 0, endSecond: 5, text: "Discover it", emphasis: "" }],
});

function selected(workspace: Workspace, kind: string) {
  const artifact = workspace.artifacts.find((item) => item.kind === kind);
  expect(artifact).toBeDefined();
  const revision = workspace.revisions.find((item) => item.id === artifact?.currentRevisionId);
  expect(revision).toBeDefined();
  return { artifact: artifact!, revision: revision! };
}

suite("guided workspace API (explicitly deferred integration)", () => {
  let projectId: string;
  let adId: string;

  beforeAll(async () => {
    if (!token) throw new Error("GUIDED_TEST_ACCESS_TOKEN must authenticate an isolated test user.");
    const result = await request("/projects", "POST", { name: `Guided acceptance ${randomUUID()}` });
    expect(result.status).toBe(201);
    projectId = (result.data.project as { id: string }).id;
  });

  beforeEach(async () => {
    const result = await request(`/projects/${projectId}/ads`, "POST", {
      title: "Guided acceptance draft", productName: "Test bottle", brandName: "Fixture",
      durationSeconds: 15, aspectRatio: "9:16", workflowMode: "GUIDED",
    });
    expect(result.status).toBe(201);
    adId = (result.data.ad as { id: string }).id;
  });

  async function save(content = script(), expectedRevisionId: string | null = null) {
    const result = await request(`/ads/${adId}/script`, "PATCH", { expectedRevisionId, content });
    expect(result.status).toBe(200);
    return result.data.workspace as Workspace;
  }

  it("reopens the exact saved script without starting a job", async () => {
    const saved = selected(await save(script("Keep this manual sentence.")), "SCRIPT");
    const result = await request(`/ads/${adId}/workspace`);
    expect(result.status).toBe(200);
    const loaded = result.data.workspace as Workspace;
    expect(selected(loaded, "SCRIPT").revision).toMatchObject({ id: saved.revision.id, content: saved.revision.content });
    expect(loaded.jobs).toHaveLength(0);
  });

  it("retains immutable script history after another save", async () => {
    const first = selected(await save(), "SCRIPT");
    const second = await save(script("A new sentence."), first.revision.id);
    expect(selected(second, "SCRIPT").revision.id).not.toBe(first.revision.id);
    expect(second.revisions.find((item) => item.id === first.revision.id)?.content).toEqual(first.revision.content);
  });

  it("rejects a stale save rather than overwriting the newer draft", async () => {
    const first = selected(await save(), "SCRIPT");
    const second = selected(await save(script("Second revision."), first.revision.id), "SCRIPT");
    const stale = await request(`/ads/${adId}/script`, "PATCH", {
      expectedRevisionId: first.revision.id, content: script("Stale tab text."),
    });
    expect(stale.status).toBe(409);
    const loaded = (await request(`/ads/${adId}/workspace`)).data.workspace as Workspace;
    expect(selected(loaded, "SCRIPT").revision.id).toBe(second.revision.id);
  });

  it("allows only one of two concurrent saves from the same revision", async () => {
    const first = selected(await save(), "SCRIPT");
    const results = await Promise.all([
      request(`/ads/${adId}/script`, "PATCH", { expectedRevisionId: first.revision.id, content: script("Tab A") }),
      request(`/ads/${adId}/script`, "PATCH", { expectedRevisionId: first.revision.id, content: script("Tab B") }),
    ]);
    expect(results.map((item) => item.status).sort()).toEqual([200, 409]);
  });

  it("ties approval to the saved revision, never to later edits", async () => {
    const first = selected(await save(), "SCRIPT");
    const approved = await request(`/ads/${adId}/approvals`, "POST", { artifactId: first.artifact.id, revisionId: first.revision.id });
    expect(approved.status).toBe(200);
    expect(selected(approved.data.workspace as Workspace, "SCRIPT").artifact.approvedRevisionId).toBe(first.revision.id);
    const edited = selected(await save(script("Not approved yet."), first.revision.id), "SCRIPT");
    expect(edited.artifact.approvedRevisionId).not.toBe(edited.revision.id);
  });

  it("rejects approval of a revision superseded by a newer draft", async () => {
    const first = selected(await save(), "SCRIPT");
    await save(script("New draft."), first.revision.id);
    const result = await request(`/ads/${adId}/approvals`, "POST", { artifactId: first.artifact.id, revisionId: first.revision.id });
    expect(result.status).toBe(409);
  });

  it("restores history as a fresh unapproved draft", async () => {
    const first = selected(await save(script("Original.")), "SCRIPT");
    await save(script("Replacement."), first.revision.id);
    const result = await request(`/ads/${adId}/revisions/${first.revision.id}/restore`, "POST", {});
    expect(result.status).toBe(200);
    const restored = selected(result.data.workspace as Workspace, "SCRIPT");
    expect(restored.revision.id).not.toBe(first.revision.id);
    expect(restored.revision.content).toEqual(first.revision.content);
    expect(restored.artifact.approvedRevisionId).not.toBe(restored.revision.id);
  });

  it("rejects invalid timing before storing a revision", async () => {
    const invalid = script();
    invalid.voiceover[0]!.endSecond = -1;
    const result = await request(`/ads/${adId}/script`, "PATCH", { expectedRevisionId: null, content: invalid });
    expect(result.status).toBe(400);
  });

  it("rejects storyboard generation without script approval", async () => {
    await save();
    const result = await request(`/ads/${adId}/actions`, "POST", {
      operation: "GENERATE_STORYBOARD", expectedRevisionId: null,
      idempotencyKey: randomUUID(), settings: { providerMode: "mock" },
    });
    expect(result.status).toBe(400);
    const workspace = (await request(`/ads/${adId}/workspace`)).data.workspace as Workspace;
    expect(workspace.jobs).toHaveLength(0);
  });

  it("deduplicates a queued storyboard action and allows cancellation without a worker", async () => {
    const first = selected(await save(), "SCRIPT");
    const approved = await request(`/ads/${adId}/approvals`, "POST", { artifactId: first.artifact.id, revisionId: first.revision.id });
    expect(approved.status).toBe(200);
    const body = { operation: "GENERATE_STORYBOARD", expectedRevisionId: null, idempotencyKey: randomUUID(), settings: { providerMode: "mock" } };
    const firstRequest = await request(`/ads/${adId}/actions`, "POST", body);
    const repeatRequest = await request(`/ads/${adId}/actions`, "POST", body);
    expect([200, 201, 202]).toContain(firstRequest.status);
    expect([200, 201, 202]).toContain(repeatRequest.status);
    const job = firstRequest.data.job as { id: string; status: string };
    expect(repeatRequest.data.job).toMatchObject({ id: job.id });
    const changed = await request(`/ads/${adId}/actions`, "POST", { ...body, settings: { providerMode: "runpod" } });
    expect(changed.status).toBe(409);
    const canceled = await request(`/pipeline-jobs/${job.id}/cancel`, "POST", {});
    expect(canceled.status).toBe(200);
    expect(canceled.data.job).toMatchObject({ id: job.id, status: "CANCELED" });
  });

  it("cannot restore a revision through another ad's URL", async () => {
    const first = selected(await save(), "SCRIPT");
    const other = await request(`/projects/${projectId}/ads`, "POST", { title: "Other test ad" });
    const otherId = (other.data.ad as { id: string }).id;
    const result = await request(`/ads/${otherId}/revisions/${first.revision.id}/restore`, "POST", {});
    expect([400, 404]).toContain(result.status);
  });
});
