import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ContentService } from "../src/application/content-service.js";
import { OperationService } from "../src/application/operation-service.js";
import { PortalService } from "../src/application/portal-service.js";
import { InMemoryAuthService } from "../src/domain/auth.js";
import { DeterministicContentAgentAdapter, type ContentAgentAdapter } from "../src/integrations/content-agent-adapter.js";

describe("CMS-OS AI非同期ジョブの段階再開", () => {
  it("content.prepare_batchがAI障害後に既存の企画案を再利用する", async () => {
    const auth = new InMemoryAuthService();
    const portal = new PortalService(auth);
    const deterministic = new DeterministicContentAgentAdapter();
    let draftCalls = 0;
    let failSecondDraft = true;
    const adapter: ContentAgentAdapter = {
      id: "retryable-test-agent",
      propose: (input) => deterministic.propose(input),
      draft: (input) => {
        draftCalls += 1;
        if (failSecondDraft && draftCalls === 2) {
          failSecondDraft = false;
          throw new Error("一時的なAI障害");
        }
        return deterministic.draft(input);
      },
      polish: (input) => deterministic.polish(input),
      translate: (input) => deterministic.translate(input),
    };
    const content = new ContentService(portal, undefined, undefined, adapter);
    const operation = new OperationService(portal, content);
    const login = auth.login("lawyer@example.com", "demo-password", "legal", "provider");
    if (!login || !("accessToken" in login)) throw new Error("再開テスト用ログインに失敗しました。");
    const jobPrincipal = auth.authenticate(login.accessToken);
    if (!jobPrincipal) throw new Error("再開テスト用セッションを取得できません。");

    const job = operation.submit(jobPrincipal, {
      operation: "content.prepare_batch",
      input: {
        category: "legal",
        items: [
          { category: "legal", contentType: "blog", audience: "customer", topic: "再開確認・相続", sourceFacts: ["確認済みの再開テスト情報です。"] },
          { category: "legal", contentType: "blog", audience: "customer", topic: "再開確認・遺言", sourceFacts: ["確認済みの再開テスト情報です。"] },
        ],
      },
    });
    const failed = await operation.execute(jobPrincipal, job.id);
    assert.equal(failed.status, "failed");
    const failedItems = failed.result?.items as Array<{ proposalId?: string; status?: string }>;
    assert.equal(failedItems.length, 2);
    assert.equal(failedItems[0]?.status, "seo_reviewed");
    assert.equal(failedItems[1]?.status, "proposed");
    const secondProposalId = failedItems[1]?.proposalId;
    assert.ok(secondProposalId);

    const succeeded = await operation.execute(jobPrincipal, job.id);
    assert.equal(succeeded.status, "succeeded");
    const completedItems = succeeded.result?.items as Array<{ proposalId?: string; status?: string }>;
    assert.equal(completedItems.length, 2);
    assert.ok(completedItems.every((item) => item.status === "seo_reviewed"));
    assert.equal(completedItems[1]?.proposalId, secondProposalId);
    assert.equal(draftCalls, 3);
    assert.equal(content.listProposals(jobPrincipal).filter((proposal) => proposal.topic.startsWith("再開確認")).length, 2);
  });
});
