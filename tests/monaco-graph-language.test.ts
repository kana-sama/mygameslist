import { describe, expect, it, vi } from "vitest";
import type { MonacoMarkdownEditorReadyContext } from "../src/components/MonacoMarkdownEditor";
import { installMonacoGraphLanguage } from "../src/components/monacoGraphLanguage";

function harness() {
  let value = 'digraph {a[state=];}';
  let changed = () => {};
  let provider: any;
  const listenerDispose = vi.fn();
  const completionDispose = vi.fn();
  const model = {
    getValue: () => value,
    getPositionAt: (offset: number) => ({lineNumber:1,column:offset+1}),
    getLineContent: () => value,
    getWordUntilPosition: ({column}: {column:number}) => ({startColumn:column,endColumn:column,word:""}),
    onDidChangeContent: (callback:()=>void) => { changed=callback; return {dispose:listenerDispose}; },
    isDisposed: () => false,
  };
  const monaco = {
    MarkerSeverity: {Error:8},
    editor: {setModelLanguage:vi.fn(),setModelMarkers:vi.fn()},
    languages: {
      register:vi.fn(),setMonarchTokensProvider:vi.fn(),
      CompletionItemKind:{EnumMember:1,Keyword:2},
      registerCompletionItemProvider:vi.fn((_language:string,next:any)=>{provider=next;return {dispose:completionDispose};}),
    },
  };
  const disposable=installMonacoGraphLanguage({model,monaco} as unknown as MonacoMarkdownEditorReadyContext);
  return {model,monaco,disposable,listenerDispose,completionDispose,get provider(){return provider;},setValue(next:string){value=next;changed();}};
}
describe('Monaco graph language',()=>{
  it('publishes precise parser diagnostics and removes markers and listeners on disposal',()=>{
    const h=harness();const markers=h.monaco.editor.setModelMarkers.mock.calls.at(-1)![2];
    expect(markers[0]).toMatchObject({severity:8,startLineNumber:1,startColumn:18});
    h.setValue('digraph { a; }');expect(h.monaco.editor.setModelMarkers.mock.calls.at(-1)![2]).toEqual([]);
    h.disposable.dispose();expect(h.listenerDispose).toHaveBeenCalledOnce();expect(h.completionDispose).toHaveBeenCalledOnce();
    expect(h.monaco.editor.setModelMarkers.mock.calls.at(-1)![2]).toEqual([]);
  });
  it('offers supported attribute and enum completions only to its own model',()=>{
    const h=harness();h.setValue('digraph {a[state=');
    const state=h.provider.provideCompletionItems(h.model,{lineNumber:1,column:18});
    expect(state.suggestions.map((s:any)=>s.label)).toEqual(['todo','doing','done']);
    h.setValue('digraph {a[');const attrs=h.provider.provideCompletionItems(h.model,{lineNumber:1,column:12});
    expect(attrs.suggestions.map((s:any)=>s.label)).toEqual(expect.arrayContaining(['label','subtitle','kind','task','state','layout']));
    expect(h.provider.provideCompletionItems({}, {lineNumber:1,column:12})).toEqual({suggestions:[]});
    h.disposable.dispose();
  });
});
