import { describe, expect, it } from 'vitest';
import { fitWithinFrame } from './framing';

describe('image framing', () => {
  it('keeps a portrait crop proportional inside a square grid', () => {
    expect(fitWithinFrame(3, 4, 1, 1)).toEqual({ left: 0.125, top: 0, width: 0.75, height: 1 });
  });

  it('fills the target when source and grid share an aspect ratio', () => {
    expect(fitWithinFrame(3, 4, 153, 204)).toEqual({ left: 0, top: 0, width: 153, height: 204 });
  });
});
