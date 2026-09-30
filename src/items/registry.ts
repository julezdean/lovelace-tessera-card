import type { ItemType } from './item-type';
import { buttonType } from './button/button';
import { graphType } from './graph/graph';
import { barType, digitsType, ringType, segmentsType } from './progress/progress';

/** An item without `type:` is a button - every config from before types. */
export const DEFAULT_TYPE = 'button';

/**
 * Every item type the card knows, in the order the editor offers them. The
 * generic parameters are erased here: past this point the card only ever
 * hands a type the items it normalised itself.
 */
const TYPES = [
  buttonType,
  ringType,
  barType,
  segmentsType,
  digitsType,
  graphType,
] as unknown as ItemType[];

const BY_NAME = new Map(TYPES.map((itemType) => [itemType.type, itemType]));

export function getItemType(name: string): ItemType | undefined {
  return BY_NAME.get(name);
}

export function itemTypes(): readonly ItemType[] {
  return TYPES;
}
