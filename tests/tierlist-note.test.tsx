import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TierListNote } from '../src/components/tierlist/TierListNote';
import { parseTierList, serializeTierList } from '../src/domain/tierList';
const source=serializeTierList({version:1,title:'Fixture',grades:[{id:'a',name:'First',cards:[{id:'one',type:'text',text:'One'},{id:'two',type:'text',text:'Two'}]},{id:'b',name:'Empty',cards:[]}]});
afterEach(async()=>{cleanup();await new Promise(r=>setTimeout(r,60));});
function key(node:HTMLElement,key:string){fireEvent.keyDown(node,{key});}
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
  const id='a'.repeat(64);render(<TierListNote source={serializeTierList({version:1,title:'',grades:[{id:'a',name:'Images',cards:[{id:'image',type:'image-text',imageAssetId:id,text:'Secret\ncaption'}]}]})} assets={{}} resolveAssetUrl={()=>'/fixture.png'} onSourceChange={vi.fn()}/>);const card=screen.getByRole('button',{name:'Карточка: Secret caption'});expect(card.querySelector('img')).toHaveAttribute('src','/fixture.png');expect(card).not.toHaveTextContent('Secret');fireEvent.mouseEnter(card);expect(screen.getByRole('tooltip')).toHaveTextContent('Secret');key(card,' ');expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();key(card,'Escape');fireEvent.click(card);expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
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
 const id='a'.repeat(64),imageSource=serializeTierList({version:1,title:'',grades:[{id:'a',name:'First',cards:[{id:'image',type:'image-text',imageAssetId:id,text:'Touch text'}]},{id:'b',name:'Second',cards:[]}]});const save=vi.fn();render(<TierListNote source={imageSource} assets={{}} resolveAssetUrl={()=>'/image'} onSourceChange={save}/>);const card=screen.getByRole('button',{name:'Карточка: Touch text'});
 fireEvent.pointerDown(card,{pointerType:'touch'});fireEvent.click(card);expect(screen.getByRole('tooltip')).toHaveTextContent('Touch text');fireEvent.click(card);expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
 const rect=(x:number,y:number,width:number,height:number)=>({x,y,left:x,top:y,right:x+width,bottom:y+height,width,height,toJSON:()=>({})});for(const [index,row] of screen.getAllByTestId('tierlist-grade').entries())vi.spyOn(row.querySelector('.tierlist-grade-cards')!,'getBoundingClientRect').mockReturnValue(rect(80,index*100,200,90));vi.spyOn(card,'getBoundingClientRect').mockReturnValue(rect(80,0,80,80));
 const touch=(y:number)=>({identifier:1,clientX:100,clientY:y});fireEvent.touchStart(card,{touches:[touch(30)],changedTouches:[touch(30)]});await act(async()=>{await new Promise(r=>setTimeout(r,270));});fireEvent.touchMove(card,{touches:[touch(130)],changedTouches:[touch(130)]});await waitFor(()=>expect(screen.getByTestId('tierlist-overlay')).toBeInTheDocument());expect(screen.getByTestId('tierlist-insertion').closest('[data-grade-id]')).toHaveAttribute('data-grade-id','b');fireEvent.touchEnd(card,{touches:[],changedTouches:[touch(130)]});await waitFor(()=>expect(save).toHaveBeenCalledOnce());fireEvent.click(screen.getByRole('button',{name:'Карточка: Touch text'}));expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
});

describe('authoritative tier-list updates during a pending move',()=>{
 it.each(['rejected','successful'] as const)('reconciles the latest source after %s settlement and retries from that document',async(outcome)=>{
  const initial=serializeTierList({version:1,title:'Original',grades:[{id:'a',name:'A',cards:[{id:'one',type:'text',text:'One'}]},{id:'b',name:'B',cards:[]}]});
  const remote=serializeTierList({version:1,title:'Remote title',grades:[{id:'a',name:'A',cards:[{id:'one',type:'text',text:'One'},{id:'remote',type:'text',text:'Remote card'}]},{id:'b',name:'B',cards:[]}]});
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
