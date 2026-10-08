import type { EditableAttachment } from '../../pages/GamePage';
import { parseTierList, tierListImageAssetIds } from '../../domain/tierList';
export function attachmentImageId(attachment:EditableAttachment):string|null{return attachment.type==='image'?attachment.assetId:attachment.type==='pending-image'?attachment.image.assetId:null;}
export function usedTierListImages(source:string):Set<string>{try{return tierListImageAssetIds(parseTierList(source));}catch{return new Set();}}
/** Only remove pool entries formerly owned by cards when their last card reference disappears. */
export function updateTierListPool(previous:string,next:string,attachments:EditableAttachment[],prepared?:EditableAttachment):EditableAttachment[]{
  const oldIds=usedTierListImages(previous),newIds=usedTierListImages(next);
  const pool=attachments.filter(a=>{const id=attachmentImageId(a);return !id||!oldIds.has(id)||newIds.has(id);});
  if(prepared){const id=attachmentImageId(prepared);if(id&&!pool.some(a=>attachmentImageId(a)===id))pool.push(prepared);}
  return pool;
}
