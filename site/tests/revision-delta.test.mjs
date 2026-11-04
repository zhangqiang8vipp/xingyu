import assert from "node:assert/strict";
import test from "node:test";
import {makeReverseDelta,applyReverseDelta} from "../domain/revision-delta.mjs";
const cases=[
  ["long unchanged","# 标题\n一行内容😀\n".repeat(200),"# 标题\n一行内容😀\n".repeat(200)],
  ["append paragraph","# 原始标题\n"+("非常详细的历史描述。\n".repeat(180)),"# 原始标题\n"+("非常详细的历史描述。\n".repeat(180))+"\n## 新段落\n本次版本变更"],
  ["small change","💡长文本\n"+("合并工作流非常重要。\n".repeat(160)),"💡长文本\n"+("合并工作流非常重要。\n".repeat(160)).replace("非常重要","特别重要")],
  ["deletion","前缀\n"+("原始正文 abcde\n".repeat(140))+"\n最后几行","前缀\n"+("原始正文 abcde\n".repeat(140))],
];
for(const [name,older,newer] of cases){
  test(name+" roundtrips in reverse",()=>{
    const patch=makeReverseDelta(newer,older);
    assert.ok(patch,"meaningful edits should compact");
    assert.equal(applyReverseDelta(newer,patch),older);
    assert.ok(new TextEncoder().encode(patch).length<new TextEncoder().encode(older).length);
    assert.throws(()=>applyReverseDelta(newer+"x",patch),/does not match/);
    assert.throws(()=>applyReverseDelta(newer,patch.slice(0,-1)),/Malformed/);
  });
}
test("major rewrite stays a full snapshot (never wastes storage)",()=>{
  const older="a".repeat(1000),newer="b".repeat(1000);
  assert.equal(makeReverseDelta(newer,older),null);
});
test("small and empty content preserve snapshots",()=>{
  assert.equal(makeReverseDelta("",""),null);
  assert.equal(makeReverseDelta("new","old"),null);
});
test("a chain of reverse patches restores every exact version",()=>{
  const v1="行😀\n".repeat(200);
  const v2=v1+"\n更新 A";
  const v3=v2+"\n更新 B";
  const d2=makeReverseDelta(v3,v2),d1=makeReverseDelta(v2,v1);
  assert.ok(d2&&d1);
  assert.equal(applyReverseDelta(applyReverseDelta(v3,d2),d1),v1);
});
