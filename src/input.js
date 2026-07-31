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
export class Input {
  constructor(domElement) {
    throw new Error('NOT IMPLEMENTED: Input');
  }
}
