import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { ContentService } from "../src/application/content-service.js";
import { InMemoryAuthService } from "../src/domain/auth.js";
import { ContentStore } from "../src/domain/content-store.js";
import { PortalStore } from "../src/domain/portal-store.js";
import { PublicationStore } from "../src/domain/publication-store.js";
import { PortalService } from "../src/application/portal-service.js";
import { JsonStateStore } from "../src/infrastructure/json-state-store.js";

let directory: string;

before(async () => {
  directory = await mkdtemp(join(tmpdir(), "cms-os-state-"));
});

after(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe("CMS-OSファイル永続化", () => {
  it("セッション、依頼、企画案を再起動後に復元できる", () => {
    const state1 = new JsonStateStore(directory);
    const auth1 = new InMemoryAuthService(state1);
    const portal1 = new PortalService(auth1, new PortalStore(state1));
    const content1 = new ContentService(portal1, new ContentStore(state1));
    const managedGuide = portal1.createDirectoryGuide({
      category: "legal",
      name: "永続化テスト案内",
      kind: "directory",
      description: "再起動後も復元される外部案内のテストです。",
      url: "https://example.com/persisted-guide",
      targetRoles: ["provider"],
      verifiedAt: "2026-07-14",
    }, true);

    const ordererLogin = auth1.login("orderer@example.com", "demo-password", "legal", "orderer");
    if (!ordererLogin || !("accessToken" in ordererLogin)) throw new Error("注文者ログインにMFAチャレンジが返されました。");
    const request = portal1.createRequest(ordererLogin.principal, {
      category: "legal",
      providerId: "provider-legal-demo",
      title: "永続化テスト依頼",
      description: "再起動後にも依頼が残ることを確認します。",
    });
    assert.ok(request.id);

    const inquiry = portal1.createInquiry(ordererLogin.principal, {
      category: "legal",
      providerId: "provider-legal-demo",
      subject: "永続化テスト問い合わせ",
      message: "問い合わせと通知が再起動後にも残ることを確認します。",
    });
    assert.ok(inquiry.id);

    const providerLogin = auth1.login("lawyer@example.com", "demo-password", "legal", "provider");
    if (!providerLogin || !("accessToken" in providerLogin)) throw new Error("事業者ログインにMFAチャレンジが返されました。");
    const proposal = content1.createProposal(providerLogin.principal, {
      category: "legal",
      contentType: "blog",
      audience: "candidate",
      topic: "永続化テスト記事",
      sourceFacts: ["確認済みのテスト情報です。"],
    });
    assert.ok(proposal.id);
    const draft = content1.createDraft(providerLogin.principal, proposal.id);
    assert.ok(draft.id);
    content1.polishContent(providerLogin.principal, draft.id);
    content1.auditSeo(providerLogin.principal, draft.id);
    content1.factCheck(providerLogin.principal, draft.id);
    const review = content1.requestReview(providerLogin.principal, draft.id);
    assert.equal(review.review.status, "requested");
    const siteAudit = content1.auditSiteSeo(providerLogin.principal);
    assert.equal(siteAudit.category, "legal");

    const state2 = new JsonStateStore(directory);
    const auth2 = new InMemoryAuthService(state2);
    const portal2 = new PortalService(auth2, new PortalStore(state2));
    const content2 = new ContentService(portal2, new ContentStore(state2));

    assert.equal(new ContentStore(state2).getSiteSeoAudit("legal", "provider-legal-demo")?.auditedAt, siteAudit.auditedAt);
    assert.deepEqual(auth2.authenticate(ordererLogin.accessToken)?.accountId, ordererLogin.principal.accountId);
    const restoredRequests = portal2.listRequests(auth2.authenticate(ordererLogin.accessToken));
    assert.equal(restoredRequests[0]?.id, request.id);
    const restoredProposals = content2.listProposals(auth2.authenticate(providerLogin.accessToken));
    assert.equal(restoredProposals[0]?.id, proposal.id);
    assert.equal(content2.getContent(auth2.authenticate(providerLogin.accessToken), draft.id)?.version, 2);
    assert.deepEqual(content2.listVersions(auth2.authenticate(providerLogin.accessToken), draft.id).map((item) => item.version), [2, 1]);
    assert.equal(content2.listReviews(auth2.authenticate(providerLogin.accessToken), draft.id)[0]?.id, review.review.id);
    const restoredNotifications = portal2.listNotifications(auth2.authenticate(providerLogin.accessToken));
    assert.ok(restoredNotifications.items.some((item) => item.resourceId === inquiry.id));
    const restoredGuides = portal2.listDirectoryGuides("legal", auth2.authenticate(providerLogin.accessToken));
    assert.ok(restoredGuides.some((guide) => guide.id === managedGuide.id));
  });

  it("公開履歴と静的ファイルスナップショットを再起動後に復元できる", () => {
    const state1 = new JsonStateStore(directory);
    const store1 = new PublicationStore(state1);
    const schedule = store1.createSchedule({
      id: "publication-schedule-persistence-test",
      publicationId: "publication-persistence-test",
      category: "legal",
      providerId: "provider-legal-demo",
      contentIds: ["content-persistence-test"],
      baseUrl: "https://www.example.com",
      scheduledFor: "2099-07-14T00:00:00.000Z",
      status: "scheduled",
    });
    const created = store1.create({
      id: "publication-persistence-test",
      category: "legal",
      providerId: "provider-legal-demo",
      baseUrl: "https://www.example.com",
      contentIds: ["content-persistence-test"],
      generatedAt: "2026-07-14T00:00:00.000Z",
      status: "published",
      files: [{ path: "index.html", contentType: "text/html; charset=utf-8", content: "<h1>永続化</h1>" }],
    });

    const state2 = new JsonStateStore(directory);
    const store2 = new PublicationStore(state2);
    const restored = store2.get(created.id);
    assert.equal(restored?.status, "published");
    assert.equal(store2.getSchedule(schedule.id)?.publicationId, created.id);
    assert.equal(store2.listSchedules("legal", "provider-legal-demo")[0]?.status, "scheduled");
    assert.equal(restored?.files[0]?.content, "<h1>永続化</h1>");
  });
});
