import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TierListNote } from '../src/components/tierlist/TierListNote';
import { parseTierList, serializeTierList } from '../src/domain/tierList';
const source=serializeTierList({version: 2,title:'Fixture',grades:[{id:'a',name:'First',cards:[{id:'one',imageAssetId:null,bodyMarkdown:'One'},{id:'two',imageAssetId:null,bodyMarkdown:'Two'}]},{id:'b',name:'Empty',cards:[]}]});
afterEach(async()=>{cleanup();await new Promise(r=>setTimeout(r,60));});
function key(node:HTMLElement,key:string){fireEvent.keyDown(node,{key});}
it('routes forward Tab from a real read-only card into its desktop tooltip links', async () => {
 const user=userEvent.setup();
 const body=serializeTierList({version:2,title:'',grades:[{id:'g',name:'A',cards:[{id:'c',imageAssetId:null,bodyMarkdown:'# Card\n\n[Guide](https://example.com)'}]}]});
 render(<><TierListNote source={body} assets={{}}/><button type="button">After board</button></>);
 const card=screen.getByRole('button',{name:'Карточка: Card'});act(()=>card.focus());fireEvent.click(card);
 const tooltip=screen.getByRole('dialog');expect(tooltip).toHaveClass('markdown-rich-tooltip--desktop');expect(card).toHaveFocus();
 await user.tab();expect(within(tooltip).getByRole('button',{name:'Закрыть'})).toHaveFocus();
 await user.tab();expect(within(tooltip).getByRole('link',{name:'Guide'})).toHaveFocus();
 await user.keyboard('{Escape}');expect(screen.queryByRole('dialog')).not.toBeInTheDocument();expect(card).toHaveFocus();
});
it.each(['text', 'image-text'])('opens legacy %s whitespace literally without saving or leaking references into the face', type => {
 const text='\n  First  line \n\t\tSecond\t \n';
 const legacy=JSON.stringify({version:1,title:'',grades:[{id:'g',name:'A',cards:[{id:'c',type,text,...(type==='image-text'?{imageAssetId:'a'.repeat(64)}:{})}]}]});
 const save=vi.fn();render(<TierListNote source={legacy} assets={{}} onSourceChange={save}/>);
 const card=screen.getByRole('button',{name:'Карточка: First line'});
 if(type==='text')expect(card.textContent).toBe('First  line');
 fireEvent.click(card);
 expect(screen.getByRole('dialog').querySelector('p')?.textContent).toBe(text);
 expect(save).not.toHaveBeenCalled();expect(JSON.parse(legacy).version).toBe(1);
});
describe('tier-list board real keyboard dragging',()=>{
 it('moves once into an empty grade with insertion, fixed overlay and stable focus/scroll',async()=>{
  const save=vi.fn().mockResolvedValue(undefined);render(<div className="note-card__viewport"><TierListNote source={source} assets={{}} onSourceChange={save}/></div>);
  const one=screen.getByRole('button',{name:'Карточка: One'});const viewport=one.closest('.note-card__viewport') as HTMLElement;viewport.scrollTop=73;act(()=>one.focus());key(one,' ');
  expect(screen.getByTestId('tierlist-overlay')).toHaveClass('tierlist-card');key(one,'ArrowDown');expect(screen.getByTestId('tierlist-insertion')).toBeInTheDocument();key(one,'Enter');
  await waitFor(()=>expect(save).toHaveBeenCalledOnce());expect(parseTierList(save.mock.calls[0][0]).grades[1].cards.map(c=>c.id)).toEqual(['one']);
  await waitFor(()=>expect(screen.getByRole('button',{name:'Карточка: One'})).toHaveFocus());expect(viewport.scrollTop).toBe(73);
 });
 it('reorders within grade, cancels with Escape and performs no write for unchanged drop',async()=>{
  const save=vi.fn();render(<TierListNote source={source} assets={{}} onSourceChange={save}/>);const one=screen.getByRole('button',{name:'Карточка: One'});act(()=>one.focus());key(one,' ');key(one,'ArrowRight');key(one,'Escape');expect(save).not.toHaveBeenCalled();key(one,' ');key(one,'Enter');expect(save).not.toHaveBeenCalled();key(one,' ');key(one,'ArrowRight');key(one,' ');await waitFor(()=>expect(save).toHaveBeenCalledOnce());expect(parseTierList(save.mock.calls[0][0]).grades[0].cards.map(c=>c.id)).toEqual(['two','one']);
 });
 it('blocks overlapping saves, rolls back a rejection and allows retry',async()=>{
  let reject!:(reason:Error)=>void;const save=vi.fn(()=>new Promise<void>((_,r)=>reject=r));render(<TierListNote source={source} assets={{}} onSourceChange={save}/>);const one=screen.getByRole('button',{name:'Карточка: One'});act(()=>one.focus());key(one,' ');key(one,'ArrowDown');key(one,'Enter');key(one,' ');key(one,'ArrowDown');key(one,'Enter');expect(save).toHaveBeenCalledOnce();await act(async()=>reject(new Error('Storage failed')));expect(screen.getByRole('alert')).toHaveTextContent('Storage failed');await waitFor(()=>expect(within(screen.getAllByTestId('tierlist-grade')[0]).getByRole('button',{name:'Карточка: One'})).toHaveFocus());save.mockResolvedValueOnce(undefined);const retry=screen.getByRole('button',{name:'Карточка: One'});key(retry,' ');key(retry,'ArrowDown');key(retry,'Enter');await waitFor(()=>expect(save).toHaveBeenCalledTimes(2));
 });
 it('shows image-text only as tooltip, closes on drag and keeps images captionless',()=>{
  const id='a'.repeat(64);render(<TierListNote source={serializeTierList({version: 2,title:'',grades:[{id:'a',name:'Images',cards:[{id:'image',imageAssetId:id,bodyMarkdown:'Secret\ncaption'}]}]})} assets={{}} resolveAssetUrl={()=>'/fixture.png'} onSourceChange={vi.fn()}/>);const card=screen.getByRole('button',{name:'Карточка: Secret'});expect(card.querySelector('img')).toHaveAttribute('src','/fixture.png');expect(card).not.toHaveTextContent('Secret');fireEvent.mouseEnter(card);expect(screen.queryByRole('dialog')).not.toBeInTheDocument();act(()=>card.focus());expect(screen.queryByRole('dialog')).not.toBeInTheDocument();fireEvent.click(card);expect(screen.getByRole('dialog')).toHaveTextContent('Secret');key(card,' ');expect(screen.queryByRole('dialog')).not.toBeInTheDocument();key(card,'Escape');fireEvent.click(card);expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
 });
});

describe('tier-list pointer insertion in actual dnd-kit context',()=>{
 it('resolves wrapped-row insertion, outside cancellation and one real mouse drop',async()=>{
  const save=vi.fn();render(<TierListNote source={source} assets={{}} onSourceChange={save}/>);
  const rect=(x:number,y:number,width:number,height:number)=>({x,y,left:x,top:y,right:x+width,bottom:y+height,width,height,toJSON:()=>({})});
  const rows=screen.getAllByTestId('tierlist-grade');for(let i=0;i<rows.length;i++){const cards=rows[i].querySelector('.tierlist-grade-cards')!;vi.spyOn(cards,'getBoundingClientRect').mockReturnValue(rect(80,i*100,200,90));}
  const one=screen.getByRole('button',{name:'Карточка: One'}),two=screen.getByRole('button',{name:'Карточка: Two'});
  vi.spyOn(one,'getBoundingClientRect').mockReturnValue(rect(80,0,80,80));vi.spyOn(two,'getBoundingClientRect').mockReturnValue(rect(168,0,80,80));
  fireEvent.mouseDown(one,{button:0,buttons:1,clientX:100,clientY:30});fireEvent.mouseMove(document,{buttons:1,clientX:110,clientY:30});fireEvent.mouseMove(document,{buttons:1,clientX:100,clientY:130});
  await waitFor(()=>expect(screen.getByTestId('tierlist-overlay')).toBeInTheDocument());fireEvent.mouseUp(document,{button:0,clientX:100,clientY:130});await waitFor(()=>expect(save).toHaveBeenCalledOnce());expect(parseTierList(save.mock.calls[0][0]).grades[1].cards[0].id).toBe('one');
 });
});
it('opens text on a touch tap and does not reopen the tooltip after delayed touch dragging',async()=>{
 const id='a'.repeat(64),imageSource=serializeTierList({version: 2,title:'',grades:[{id:'a',name:'First',cards:[{id:'image',imageAssetId:id,bodyMarkdown:'Touch text'}]},{id:'b',name:'Second',cards:[]}]});const save=vi.fn();render(<TierListNote source={imageSource} assets={{}} resolveAssetUrl={()=>'/image'} onSourceChange={save}/>);const card=screen.getByRole('button',{name:'Карточка: Touch text'});
 fireEvent.pointerDown(card,{pointerType:'touch'});fireEvent.click(card);expect(screen.getByRole('dialog')).toHaveTextContent('Touch text');fireEvent.click(card);expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
 const rect=(x:number,y:number,width:number,height:number)=>({x,y,left:x,top:y,right:x+width,bottom:y+height,width,height,toJSON:()=>({})});for(const [index,row] of screen.getAllByTestId('tierlist-grade').entries())vi.spyOn(row.querySelector('.tierlist-grade-cards')!,'getBoundingClientRect').mockReturnValue(rect(80,index*100,200,90));vi.spyOn(card,'getBoundingClientRect').mockReturnValue(rect(80,0,80,80));
 const touch=(y:number)=>({identifier:1,clientX:100,clientY:y});fireEvent.touchStart(card,{touches:[touch(30)],changedTouches:[touch(30)]});await act(async()=>{await new Promise(r=>setTimeout(r,270));});fireEvent.touchMove(card,{touches:[touch(130)],changedTouches:[touch(130)]});await waitFor(()=>expect(screen.getByTestId('tierlist-overlay')).toBeInTheDocument());expect(screen.getByTestId('tierlist-insertion').closest('[data-grade-id]')).toHaveAttribute('data-grade-id','b');fireEvent.touchEnd(card,{touches:[],changedTouches:[touch(130)]});fireEvent.click(screen.getByRole('button',{name:'Карточка: Touch text'}));expect(screen.queryByRole('dialog')).not.toBeInTheDocument();await waitFor(()=>expect(save).toHaveBeenCalledOnce());
});

describe('authoritative tier-list updates during a pending move',()=>{
 it.each(['rejected','successful'] as const)('reconciles the latest source after %s settlement and retries from that document',async(outcome)=>{
  const initial=serializeTierList({version: 2,title:'Original',grades:[{id:'a',name:'A',cards:[{id:'one',imageAssetId:null,bodyMarkdown:'One'}]},{id:'b',name:'B',cards:[]}]});
  const remote=serializeTierList({version: 2,title:'Remote title',grades:[{id:'a',name:'A',cards:[{id:'one',imageAssetId:null,bodyMarkdown:'One'},{id:'remote',imageAssetId:null,bodyMarkdown:'Remote card'}]},{id:'b',name:'B',cards:[]}]});
  let resolve!:()=>void,reject!:(reason:Error)=>void;
  const save=vi.fn().mockImplementationOnce(()=>new Promise<void>((r,j)=>{resolve=r;reject=j;})).mockResolvedValue(undefined);
  const view=(body:string)=><div className="note-card__viewport"><TierListNote source={body} assets={{}} onSourceChange={save}/></div>;
  const {rerender}=render(view(initial));const one=screen.getByRole('button',{name:'Карточка: One'}),viewport=one.closest('.note-card__viewport') as HTMLElement;viewport.scrollTop=61;act(()=>one.focus());key(one,' ');key(one,'ArrowDown');key(one,'Enter');expect(save).toHaveBeenCalledOnce();
  rerender(view(remote));const pendingCard=screen.getByRole('button',{name:'Карточка: One'});key(pendingCard,' ');expect(screen.queryByTestId('tierlist-overlay')).not.toBeInTheDocument();expect(save).toHaveBeenCalledOnce();
  await act(async()=>{if(outcome==='rejected')reject(new Error('Stale source'));else resolve();});
  expect(screen.getByRole('heading',{name:'Remote title'})).toBeInTheDocument();expect(screen.getByRole('button',{name:'Карточка: Remote card'})).toBeInTheDocument();
  const restored=within(screen.getAllByTestId('tierlist-grade')[0]).getByRole('button',{name:'Карточка: One'});await waitFor(()=>expect(restored).toHaveFocus());expect(viewport.scrollTop).toBe(61);
  if(outcome==='rejected')expect(screen.getByRole('alert')).toHaveTextContent('Stale source');
  key(restored,' ');key(restored,'ArrowDown');key(restored,'Enter');await waitFor(()=>expect(save).toHaveBeenCalledTimes(2));
  expect(parseTierList(save.mock.calls[1][0])).toMatchObject({title:'Remote title',grades:[{id:'a',cards:[{id:'remote'}]},{id:'b',cards:[{id:'one'}]}]});
 });
});

it('suppresses only the gesture-ending click and allows later keyboard activation of the same card', async () => {
 const save=vi.fn();render(<TierListNote source={source} assets={{}} onSourceChange={save}/>);const card=screen.getByRole('button',{name:'Карточка: One'});
 key(card,' ');key(card,'Escape');fireEvent.click(card);expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
 key(card,' ');key(card,'Escape');await act(async()=>{await new Promise(resolve=>setTimeout(resolve,25));});fireEvent.click(card);
 expect(screen.getByRole('dialog')).toBeInTheDocument();expect(save).not.toHaveBeenCalled();
});
