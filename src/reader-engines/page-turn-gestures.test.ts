import { PageTurnGestures, type PageTurnDirection } from './page-turn-gestures';

function touch(type: 'pointerdown' | 'pointerup', x: number, y: number) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    button: { value: 0 },
    clientX: { value: x },
    clientY: { value: y },
    pointerType: { value: 'touch' },
  });
  return event;
}

function wheel(deltaY: number, init: WheelEventInit = {}) {
  return new WheelEvent('wheel', { cancelable: true, deltaY, ...init });
}

function setup() {
  let time = 1_000;
  const turns: PageTurnDirection[] = [];
  const gestures = new PageTurnGestures(
    (direction) => {
      turns.push(direction);
      return Promise.reject(new Error('navigation failures are ignored'));
    },
    () => time,
  );
  const detach = gestures.attach(document);
  return {
    detach,
    gestures,
    turns,
    advance: (milliseconds: number) => {
      time += milliseconds;
    },
  };
}

describe('PageTurnGestures', () => {
  it('accumulates wheel deltas and throttles page turns', () => {
    const { advance, detach, turns } = setup();

    document.dispatchEvent(wheel(40));
    expect(turns).toEqual([]);
    document.dispatchEvent(wheel(60));
    document.dispatchEvent(wheel(200));
    expect(turns).toEqual(['next']);

    advance(400);
    document.dispatchEvent(wheel(-120));
    expect(turns).toEqual(['next', 'previous']);
    detach();
  });

  it('ignores zoom gestures, zero deltas, and interactive targets', () => {
    const { detach, turns } = setup();
    const button = document.createElement('button');
    document.body.append(button);

    const zoom = wheel(500, { ctrlKey: true });
    document.dispatchEvent(zoom);
    document.dispatchEvent(wheel(0));
    button.dispatchEvent(
      new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 500 }),
    );
    button.dispatchEvent(touch('pointerdown', 300, 100));
    document.dispatchEvent(touch('pointerup', 100, 100));

    expect(zoom.defaultPrevented).toBe(false);
    expect(turns).toEqual([]);
    button.remove();
    detach();
  });

  it('turns pages on horizontal swipes only', () => {
    const { advance, detach, turns } = setup();

    document.dispatchEvent(touch('pointerdown', 100, 100));
    document.dispatchEvent(touch('pointerup', 110, 300));
    document.dispatchEvent(touch('pointerdown', 100, 100));
    document.dispatchEvent(touch('pointerup', 300, 110));
    advance(400);
    document.dispatchEvent(touch('pointerdown', 300, 100));
    document.dispatchEvent(new Event('pointercancel'));
    document.dispatchEvent(touch('pointerup', 100, 100));

    expect(turns).toEqual(['previous']);
    detach();
  });

  it('stops listening after detach and clears partial gestures on reset', () => {
    const { detach, gestures, turns } = setup();

    document.dispatchEvent(wheel(60));
    gestures.reset();
    document.dispatchEvent(wheel(60));
    expect(turns).toEqual([]);

    detach();
    document.dispatchEvent(wheel(500));
    expect(turns).toEqual([]);
  });
});
