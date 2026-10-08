import type { TierListDocument } from '../../domain/tierList';
export interface TierListPlacement { gradeId: string; index: number }
export interface CardRectangle { id: string; left: number; right: number; top: number; bottom: number }
/** Resolve the visual insertion point across wrapped rows; indices exclude the dragged card. */
export function pointerTierListPlacement(gradeId: string, cards: readonly CardRectangle[], point: {x:number;y:number}): TierListPlacement {
  if (!cards.length) return {gradeId,index:0};
  const rows: CardRectangle[][]=[];
  for(const card of cards){const last=rows.at(-1);if(last && Math.abs(last[0].top-card.top)<2)last.push(card);else rows.push([card]);}
  let rowIndex=rows.findIndex((row,index)=> index===rows.length-1 || point.y < (row[0].bottom+rows[index+1][0].top)/2);
  if(rowIndex<0)rowIndex=rows.length-1;
  const row=rows[rowIndex];const preceding=rows.slice(0,rowIndex).reduce((n,r)=>n+r.length,0);
  const column=row.findIndex(card=>point.x<(card.left+card.right)/2);
  return {gradeId,index:preceding+(column<0?row.length:column)};
}
export function keyboardTierListPlacement(document:TierListDocument,cardId:string,placement:TierListPlacement,key:string):TierListPlacement {
  const gradeIndex=document.grades.findIndex(g=>g.id===placement.gradeId);
  let nextGradeIndex=gradeIndex,index=placement.index;
  if(key==='ArrowUp')nextGradeIndex=Math.max(0,gradeIndex-1);
  if(key==='ArrowDown')nextGradeIndex=Math.min(document.grades.length-1,gradeIndex+1);
  if(key==='ArrowLeft')index--;
  if(key==='ArrowRight')index++;
  const grade=document.grades[nextGradeIndex];
  const length=grade.cards.filter(c=>c.id!==cardId).length;
  if(key==='Home')index=0;
  if(key==='End')index=length;
  return {gradeId:grade.id,index:Math.min(length,Math.max(0,index))};
}
