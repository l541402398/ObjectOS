# Historical capture

`intermediate-assertion-failure.png` records an intermediate readonly-journey assertion failure.
The write was denied; the assertion incorrectly relied on a custom Error property crossing
Electron contextBridge. The final test checks the static permission message and unchanged catalog,
and separate HTTP tests assert 403. This capture is diagnostic, not a final visual baseline.
