# TUNNELRAT

Procgen 6DOF mine crawler, Descent-style. Three.js prototype.

**Play it: [tront.xyz/tunnelrat](https://tront.xyz/tunnelrat/)**

Graph-planned missions carved into marching-cubes caves; the density field is the
level, the collision, and the enemy line-of-sight all at once. Find the keycard,
open the door, kill the reactor, fly out before it blows, descend deeper.

## Run

```
node tools/serve.mjs        # http://localhost:8123
```

Click to lock the mouse. WASD + R/F strafe, mouse pitch/yaw, Q/E roll, Shift boost,
click/Space fire, Tab automap, V chase cam, M mute, Enter retry/descend.
Xbox controller works too: sticks strafe/look, bumpers roll, RT fire, LT boost,
Start retry, Back automap, Y camera. Die and your burned ship + XP orbs wait
where you fell.

## Verify

```
node tools/shoot.mjs http://localhost:8123 shot.png 9000
node tools/smoketest.mjs    # loads the game headless, runs the loop via window.TR.debug
```
