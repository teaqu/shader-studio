import { describe, expect, it, vi } from 'vitest';
import { ScriptKeyboardInput } from '../lib/ScriptKeyboardInput';

describe('script keyboard input',()=>{
  it('preserves ordered events, repeat, modifiers, physical codes and Unicode for the focused canvas',()=>{
    const canvas=document.createElement('canvas');canvas.tabIndex=0;document.body.append(canvas);
    const send=vi.fn();const input=new ScriptKeyboardInput(canvas,send);
    canvas.dispatchEvent(new KeyboardEvent('keydown',{key:'x'}));expect(send).not.toHaveBeenCalled();
    canvas.focus();canvas.dispatchEvent(new KeyboardEvent('keydown',{key:'😀',code:'KeyA',repeat:true,shiftKey:true}));
    canvas.dispatchEvent(new KeyboardEvent('keyup',{key:'😀',code:'KeyA'}));
    expect(send.mock.calls[0][0]).toMatchObject({type:'keydown',key:'😀',code:'KeyA',repeat:true,shiftKey:true});
    expect(send.mock.calls[1][0].type).toBe('keyup');canvas.blur();expect(send.mock.calls[2][0].type).toBe('release_all');
    input.dispose();canvas.focus();canvas.dispatchEvent(new KeyboardEvent('keydown'));expect(send).toHaveBeenCalledTimes(3);canvas.remove();
  });
  it('forwards composed or pasted text only from the focused preview',()=>{
    const canvas=document.createElement('canvas');canvas.tabIndex=0;document.body.append(canvas);const send=vi.fn();const input=new ScriptKeyboardInput(canvas,send);
    canvas.dispatchEvent(new CompositionEvent('compositionend',{data:'字'}));expect(send).not.toHaveBeenCalled();canvas.focus();
    canvas.dispatchEvent(new CompositionEvent('compositionend',{data:'字'}));
    const event=new Event('paste');Object.defineProperty(event,'clipboardData',{value:{getData:()=> '😀abc'}});canvas.dispatchEvent(event);
    expect(send.mock.calls.map(([e])=>e.text)).toEqual(['字','😀abc']);
    input.dispose();canvas.remove();
  });
});

it('ignores paste without clipboard text and keys after focus moves away',()=>{
  const canvas=document.createElement('canvas');canvas.tabIndex=0;document.body.append(canvas);const send=vi.fn();const input=new ScriptKeyboardInput(canvas,send);
  canvas.dispatchEvent(new Event('paste'));canvas.focus();canvas.dispatchEvent(new Event('paste'));
  canvas.dispatchEvent(new CompositionEvent('compositionend',{data:''}));expect(send).not.toHaveBeenCalled();input.dispose();canvas.remove();
});
