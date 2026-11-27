import type { CSSProperties } from 'react';
import type { TextLayer } from '../../document';
import { withAppFont } from './appFont';
import { cssFontFamily } from './fontFamily';

/** Estilo del campo para una capa de texto dibujada a `scale` píxeles por unidad del lienzo. */
export function textEditStyle(layer: TextLayer, scale: number): CSSProperties {
  return {
    position: 'absolute',
    left: layer.x * scale,
    top: layer.y * scale,
    width: layer.width * scale,
    height: layer.height * scale,
    transform: layer.rotation ? `rotate(${layer.rotation}deg)` : undefined,
    transformOrigin: 'center center',
    fontFamily: cssFontFamily(withAppFont(layer.fontFamily)),
    fontSize: layer.fontSize * scale,
    fontWeight: layer.fontWeight,
    fontStyle: layer.italic ? 'italic' : 'normal',
    lineHeight: layer.lineHeight,
    color: layer.color,
    textAlign: layer.align,
    opacity: layer.opacity,
    padding: 0,
    margin: 0,
    border: 'none',
    background: 'transparent',
    resize: 'none',
    overflow: 'hidden',
    whiteSpace: 'pre-wrap',
    overflowWrap: 'break-word',
    boxSizing: 'border-box',
  };
}
