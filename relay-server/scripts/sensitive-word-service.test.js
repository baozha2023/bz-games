import assert from "node:assert/strict";
import test from "node:test";

import { createSensitiveWordService } from "../src/services/sensitive-word-service.js";

const service = createSensitiveWordService();

test("curated vocabulary leaves normal forum copy unchanged", () => {
  const content = "BZ-Games 论坛正式上线，欢迎大家发布帖子、分享图片、点赞和评论。";
  assert.equal(service.filterText(content), content);
});

test("curated vocabulary filters high-risk categories", () => {
  for (const content of ["赌博", "冰毒", "强奸", "傻逼", "政府"]) {
    const filtered = service.filterText(content);
    assert.notEqual(filtered, content, `expected ${content} to be filtered`);
    assert.equal(filtered, "*".repeat(Array.from(content).length));
  }
});

test("curated vocabulary does not filter a normal character inside a word", () => {
  assert.equal(service.filterText("提出建议"), "提出建议");
});
