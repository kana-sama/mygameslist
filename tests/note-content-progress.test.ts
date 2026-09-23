import { describe, expect, it } from "vitest";
import { resolveNoteContentProgress } from "../src/domain/noteContent";
describe('format-aware note progress',()=>{
 it('aggregates graph descendants once, ignores information nodes, and preserves Markdown progress',()=>{
  expect(resolveNoteContentProgress({format:'graph',bodyMarkdown:'digraph {subgraph g {a[state=done]; b[state=doing]; c[task=false];}}'})).toEqual({status:'ok',checked:1,total:2});
  expect(resolveNoteContentProgress({bodyMarkdown:'- [x] Done\n- [ ] Open'})).toEqual({status:'ok',checked:1,total:2});
 });
 it('does not treat graph-like Markdown as graph progress and reports invalid or taskless graphs',()=>{
  expect(resolveNoteContentProgress({bodyMarkdown:'digraph { a; }'})).toEqual({status:'error'});
  expect(resolveNoteContentProgress({format:'graph',bodyMarkdown:'digraph {a[task=false];}'})).toEqual({status:'error'});
  expect(resolveNoteContentProgress({format:'graph',bodyMarkdown:'digraph {'})).toEqual({status:'error'});
 });
});
