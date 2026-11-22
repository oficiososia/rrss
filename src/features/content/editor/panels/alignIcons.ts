import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignStartHorizontal,
  AlignStartVertical,
  type LucideIcon,
} from 'lucide-react';
import type { AlignTarget } from '../arrange';

export const ALIGN_ICONS: [AlignTarget, LucideIcon][] = [
  ['left', AlignStartVertical],
  ['centerX', AlignCenterVertical],
  ['right', AlignEndVertical],
  ['top', AlignStartHorizontal],
  ['middle', AlignCenterHorizontal],
  ['bottom', AlignEndHorizontal],
];
