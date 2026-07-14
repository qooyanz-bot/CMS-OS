import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const readmeFiles = ["README.md", "README.en.md", "README.zh-CN.md", "README.es.md", "README.ko.md", "README.de.md", "README.fr.md"];
const languageLinks = ["README.md", "README.en.md", "README.zh-CN.md", "README.es.md", "README.ko.md", "README.de.md", "README.fr.md"];

describe("CMS-OS README多言語管理", () => {
  it("7言語版が存在し、相互リンクとUTF-8の本文を維持する", () => {
    for (const file of readmeFiles) {
      const path = resolve(process.cwd(), file);
      assert.equal(existsSync(path), true, `${file}が存在しません`);
      const content = readFileSync(path, "utf8");
      assert.equal(content.includes("�"), false, `${file}にUTF-8の置換文字があります`);
      assert.equal(/[繧縺譁螟莠貂ﾃ窶]/u.test(content), false, `${file}に文字化けした本文があります`);
      for (const linkedFile of languageLinks) assert.equal(content.includes(`(${linkedFile})`), true, `${file}から${linkedFile}へリンクされていません`);
    }
  });
});
