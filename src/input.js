// input.js : pointer lock + keyboard state. No game logic here.
//
// CONTRACT (implement exactly):
//
// class Input {
//   constructor(domElement)   // canvas/app element: click requests pointer lock
//   pointerLocked: boolean
//   mouseDX, mouseDY: number  // accumulated pixels since last endFrame()
//   fire: boolean             // mouse0 OR Space held
//   boost: boolean            // ShiftLeft held
//   axis: { x, y, z, roll }   // each -1|0|1 :
//     x: KeyD(+1)/KeyA(-1) strafe right/left
//     y: KeyR or Space(+1) / KeyF or ControlLeft(-1) strafe up/down
//     z: KeyW(+1)/KeyS(-1) forward/back
//     roll: KeyE(+1)/KeyQ(-1)
//   justPressed(code) -> boolean  // edge-triggered, true once per physical press,
//                                 // cleared in endFrame(). e.g. 'Tab', 'Enter', 'KeyM'
//   endFrame()                    // zero mouse deltas + edge set; call once per frame at loop end
// }
//
// Tab must preventDefault (browser focus stealing). Also preventDefault on Space and
// arrow keys. Listen on window; ignore key events when an <input> has focus (none exist,
// belt and braces). Mouse deltas only accumulate while pointerLocked.

const PREVENT_DEFAULT_CODES = new Set([
  'Tab', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
]);

function isTypingIntoField() {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable;
}

export class Input {
  constructor(domElement) {
    this.domElement = domElement;
    this.pointerLocked = false;
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.fire = false;
    this.boost = false;
    this.axis = { x: 0, y: 0, z: 0, roll: 0 };

    this._keys = new Set();
    this._justPressed = new Set();
    this._mouse0 = false;

    domElement.addEventListener('click', () => {
      if (!this.pointerLocked) domElement.requestPointerLock();
    });

    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === domElement;
    });

    window.addEventListener('mousemove', (e) => {
      if (!this.pointerLocked) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });

    window.addEventListener('mousedown', (e) => {
      if (e.button === 0) {
        this._mouse0 = true;
        this._recompute();
      }
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) {
        this._mouse0 = false;
        this._recompute();
      }
    });

    window.addEventListener('keydown', (e) => {
      if (isTypingIntoField()) return;
      if (PREVENT_DEFAULT_CODES.has(e.code)) e.preventDefault();
      if (!this._keys.has(e.code)) this._justPressed.add(e.code);
      this._keys.add(e.code);
      this._recompute();
    });

    window.addEventListener('keyup', (e) => {
      if (isTypingIntoField()) return;
      if (PREVENT_DEFAULT_CODES.has(e.code)) e.preventDefault();
      this._keys.delete(e.code);
      this._recompute();
    });

    // lost focus / alt-tab: stop ghost-held keys
    window.addEventListener('blur', () => {
      this._keys.clear();
      this._mouse0 = false;
      this._recompute();
    });
  }

  _recompute() {
    const k = this._keys;
    const a = this.axis;
    a.x = (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0);
    a.y = (k.has('KeyR') || k.has('Space') ? 1 : 0) - (k.has('KeyF') || k.has('ControlLeft') ? 1 : 0);
    a.z = (k.has('KeyW') ? 1 : 0) - (k.has('KeyS') ? 1 : 0);
    a.roll = (k.has('KeyE') ? 1 : 0) - (k.has('KeyQ') ? 1 : 0);
    this.boost = k.has('ShiftLeft');
    this.fire = this._mouse0 || k.has('Space');
  }

  justPressed(code) {
    return this._justPressed.has(code);
  }

  endFrame() {
    this.mouseDX = 0;
    this.mouseDY = 0;
    this._justPressed.clear();
  }
}
